import { Context, Logger, Random, Schema, Session, h, sleep } from "koishi";
import {} from "koishi-plugin-monetary";

export const name = "bull-card";
export const inject = {
  database: { required: true },
  monetary: { required: false }
};
export const logger = new Logger("bullCard");

export const usage = `## 使用

- 发送指令 \`bullCard\` 查看帮助。
- 发送指令 \`来一局\` 即可发起游戏。
- **娱乐模式**：发送设置的暗号（默认 \`1\`）加入。
- **金币模式（需要 monetary 服务）**：发送 \`下注金额\`（数字）加入。
- 时间到后自动开始、发牌、结算。

## 金币模式倍率
- **五小牛/五花牛/四炸**: x4
- **牛牛**: x3
- **牛七 ~ 牛九**: x2
- **牛一 ~ 牛六**: x1
- **没牛**: x1

## QQ 群
956758505
`;
export interface Config {
  atReply: boolean;
  quoteReply: boolean;
  waitTimeout: number;
  entryKeyword: string;
  quickMode: boolean;
  dealInterval: number;
  enableMonetary: boolean;
  currencyName: string;
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    enableMonetary: Schema.boolean().default(false).description("开启金币系统(需要 monetary 服务)"),
    currencyName: Schema.string().default("default").description("货币名称"),
  }).description("货币设置"),

  Schema.object({
    waitTimeout: Schema.number().default(10).description("等待玩家加入的时间(秒)"),
    entryKeyword: Schema.string().default("1").description("加入游戏的指令暗号(仅娱乐模式)"),
  }).description("游戏设置"),

  Schema.object({
    quickMode: Schema.boolean().default(false).description("快速模式：开启后直接显示所有结果，不逐个发牌"),
    dealInterval: Schema.number().default(2000).description("发牌展示间隔(毫秒，关闭快速模式时有效)"),
  }).description("显示设置"),

  Schema.object({
    atReply: Schema.boolean().default(false).description("响应时 @"),
    quoteReply: Schema.boolean().default(true).description("响应时引用"),
  }).description("消息设置"),
]);

// 数据库表扩充
declare module "koishi" {
  interface Tables {
    bull_card_games: BullCardGames;
    bull_card_players: BullCardPlayers;
    bull_card_rank: BullCardRank;
  }
}

export enum GameState {
  IDLE = 0,
  RECRUITING = 1,
  PLAYING = 2,
}

export interface BullCardGames {
  channelId: string;
  state: GameState;
  members: string[];
  bets: Record<string, number>; // 存储玩家下注金额 { userId: amount }
  updatedAt: Date;
}

export interface BullCardPlayers {
  channelId: string;
  userId: string;
  userName: string;
  hand: Card[];
  resultScore: number;
  resultName: string;
  maxCard: Card;
  bet?: number; // 缓存该局下注
}

export interface BullCardRank {
  userId: string;
  userName: string;
  wins: number;
  losses: number;
  earnings: number; // 净赚金额
}

// 基础类型定义
enum Suit {
  Spade = "♠",
  Heart = "♥",
  Club = "♣",
  Diamond = "♦",
}

enum Rank {
  Ace = "A",
  Two = "2",
  Three = "3",
  Four = "4",
  Five = "5",
  Six = "6",
  Seven = "7",
  Eight = "8",
  Nine = "9",
  Ten = "10",
  Jack = "J",
  Queen = "Q",
  King = "K",
}

interface Card {
  suit: Suit;
  rank: Rank;
}

// 常量
const SUIT_WEIGHT = { "♠": 4, "♥": 3, "♣": 2, "♦": 1 };
const RANK_VALUE = {
  A: 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
  J: 11, Q: 12, K: 13,
};
const CARD_POINT = {
  A: 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
  J: 10, Q: 10, K: 10,
};

export function apply(ctx: Context, cfg: Config) {
  const timers: Record<string, () => void> = {};
  ctx = ctx.guild();

  // 数据模型
  ctx.model.extend(
    "bull_card_games",
    {
      channelId: "string",
      state: { type: "integer", initial: 0 },
      members: "list",
      bets: "json",
      updatedAt: "timestamp",
    },
    { primary: 'channelId' }
  );

  ctx.model.extend(
    "bull_card_players",
    {
      channelId: "string",
      userId: "string",
      userName: "string",
      hand: "json",
      resultScore: "integer",
      resultName: "string",
      maxCard: "json",
      bet: { type: "double", initial: 0 },
    },
    { primary: ['channelId', 'userId'] }
  );

  ctx.model.extend(
    "bull_card_rank",
    {
      userId: "string",
      userName: "string",
      wins: "unsigned",
      losses: "unsigned",
      earnings: { type: "double", initial: 0 },
    },
    { primary: 'userId' }
  );

  // --- 中间件：监听加入指令 ---
  ctx.middleware(async (session, next) => {
    const content = session.content?.trim();
    if (!content) return next();

    // 获取游戏状态
    const game = (await ctx.database.get("bull_card_games", { channelId: session.channelId }))[0];
    if (!game || game.state !== GameState.RECRUITING) return next();

    // 防止重复加入
    if (game.members.includes(session.userId)) return next();

    let betAmount = 0;

    // 分支处理：金币模式 vs 娱乐模式
    if (cfg.enableMonetary) {
      // 检查 monetary 服务
      if (!ctx.monetary) {
        logger.warn("Configured enableMonetary but monetary service is missing.");
        return next();
      }

      // 尝试解析金额
      const num = parseFloat(content);
      // 必须是正整数
      if (isNaN(num) || num <= 0 || !Number.isInteger(num)) return next();

      betAmount = num;

      // 检查余额并预扣款
      try {
        const uid = (await ctx.database.getUser(session.platform, session.userId)).id;
        const [userMonetary] = await ctx.database.get("monetary", { uid,currency: cfg.currencyName });
        const userMoney = userMonetary.value;
        if (userMoney < betAmount) {
           session.send(`${h.at(session.userId)} 你的钱不够下注 ${betAmount}！当前余额：${userMoney}`);
           return
        }
        // 扣除金额（如果游戏取消或平局会退还）
        await ctx.monetary.cost(uid, betAmount, cfg.currencyName);
      } catch (err) {
        logger.error(err);
         session.send("无法获取余额信息。");
         return
      }

    } else {
      // 娱乐模式：必须匹配关键词
      if (content !== cfg.entryKeyword) return next();
    }

    // 更新数据库：加入玩家
    const newMembers = [...game.members, session.userId];
    const newBets = { ...(game.bets || {}), [session.userId]: betAmount };

    await ctx.database.set("bull_card_games", { channelId: session.channelId }, {
      members: newMembers,
      bets: newBets,
      updatedAt: new Date()
    });

    // 确保排行榜名字更新
    await ensureRank(ctx, session.userId, session.username);

    if (cfg.enableMonetary) {
      await session.send(`${h.at(session.userId)} 投入 ${betAmount} 加入赌局！(当前 ${newMembers.length} 人)`);
    } else {
      await session.send(`${h.at(session.userId)} 加入成功！当前人数：${newMembers.length}`);
    }

    return; // 拦截
  });

  // --- 主指令 ---
  ctx.command("bullCard","斗牛纸牌游戏")
    .action(async ({ session }) => {
      const modeDesc = cfg.enableMonetary ? "💰 金币赌注模式" : "🎮 纯娱乐模式";
      return sendMsg(session,
        `🎮 斗牛纸牌游戏指令列表 [${modeDesc}]：\n` +
        `• bullCard.来一局 - 发起游戏\n` +
        `• bullCard.排行榜 - 查看榜单\n` +
        `• bullCard.强制结束 - 强制重置（退还赌注）\n\n` +
        (cfg.enableMonetary ?
        `💰 规则：Bot作为庄家，玩家下注后与Bot比牌。\n若玩家赢，获得本金 + 赌注 x 牌型倍率。\n` :
        `📋 规则：玩家之间互相比牌，最大者胜。\n`) +
        `\n🎴 牌面计算规则：\n` +
        `• 每局五张牌，任选三张和为10的倍数\n` +
        `• 剩余两张和取余10为结果（牛几）\n` +
        `• JQK计10，A计1，其他按牌面计\n` +
        `• 剩余两张和亦为10倍数：牛牛（结果10）\n` +
        `• 无三张可组10倍数：没牛（结果0）\n\n` +
        `🌟 特殊牌型：\n` +
        `• 四张同点：四炸\n` +
        `• 全为JQK：五花牛\n` +
        `• 全为小于5的牌且总和≤10：五小牛\n\n` +
        `📊 牌型大小：五小牛 > 五花牛 > 四炸 > 牛牛 > 牛九 > ... > 牛丁 > 没牛\n` +
        `同分时比较最大单牌（点数 > 花色）`
      );
    })

  ctx.command("bullCard.来一局", "发起斗牛游戏")
    .action(async ({ session }) => {
      const { channelId, userId, username } = session;
      clearGameTimer(channelId);

      // 1. 检查并清理死局
      let game = (await ctx.database.get("bull_card_games", { channelId }))[0];
      if (game && game.state !== GameState.IDLE) {
        const diff = Date.now() - game.updatedAt.getTime();
        if (diff > 10 * 60 * 1000) {
           await resetGame(session.platform,channelId); // 超时自动重置并退款
           game = null;
        } else {
           return sendMsg(session, "🚫 当前有游戏正在进行中，请稍后再试或输入【bullCard.强制结束】");
        }
      }

      // 2. 初始化
      // 如果是金币模式，发起者只是发起，不自动加入（因为要输入金额）
      // 如果是娱乐模式，发起者自动加入
      const initialMembers = cfg.enableMonetary ? [] : [userId];

      if (!game) {
        await ctx.database.create("bull_card_games", {
          channelId,
          state: GameState.RECRUITING,
          members: initialMembers,
          bets: {},
          updatedAt: new Date(),
        });
      } else {
        await ctx.database.set("bull_card_games", { channelId }, {
          state: GameState.RECRUITING,
          members: initialMembers,
          bets: {},
          updatedAt: new Date(),
        });
      }

      await ensureRank(ctx, userId, username);

      // 3. 发送招募消息
      if (cfg.enableMonetary) {
        await sendMsg(session,
          `📢 斗牛【金币局】开始！\n` +
          `发起人：${username}\n` +
          `请在 ${cfg.waitTimeout} 秒内发送【下注金额】(纯数字)加入挑战庄家！`
        );
      } else {
        await sendMsg(session,
          `📢 斗牛【娱乐局】开始！\n` +
          `发起人：${username}\n` +
          `请想玩的成员在 ${cfg.waitTimeout} 秒内发送【${cfg.entryKeyword}】加入游戏！`
        );
      }

      // 4. 定时器
      const dispose = ctx.setTimeout(async () => {
        delete timers[channelId];
        await runAutoGame(session);
      }, cfg.waitTimeout * 1000);

      timers[channelId] = dispose;
    });

  ctx.command("bullCard.强制结束", "强制重置当前群游戏状态", { authority: 2 })
    .action(async ({ session }) => {
      await resetGame(session.platform,session.channelId, true); // true = 需要提示退款
      return "已重置游戏状态，若有下注已退还。";
    });

  ctx.command("bullCard.排行榜", "查看积分榜")
    .action(async ({ session }) => {
      const list = await ctx.database.get("bull_card_rank", {});
      if (list.length === 0) return sendMsg(session, "暂无数据。");

      if (cfg.enableMonetary) {
        // 金币模式：按净赚排序
        const top10 = list.sort((a, b) => b.earnings - a.earnings).slice(0, 10);
        const lines = top10.map((p, i) => {
            const icon = p.earnings >= 0 ? "📈" : "📉";
            return `${i + 1}. ${p.userName} : ${icon} ${p.earnings}`;
        });
        return sendMsg(session, `💰 斗牛富豪榜 (净盈亏) 💰\n${lines.join("\n")}`);
      } else {
        // 娱乐模式：按胜场排序
        const top10 = list.sort((a, b) => b.wins - a.wins).slice(0, 10);
        const lines = top10.map((p, i) => `${i + 1}. [胜:${p.wins}|负:${p.losses}] ${p.userName}`);
        return sendMsg(session, `🏆 斗牛胜负榜 🏆\n${lines.join("\n")}`);
      }
    });

  // --- 核心逻辑 ---

  async function runAutoGame(session: Session) {
    const { channelId } = session;
    const game = (await ctx.database.get("bull_card_games", { channelId }))[0];

    if (!game || game.state !== GameState.RECRUITING) return;

    const members = game.members;
    // 金币模式下至少1人即可（因为和Bot玩）；娱乐模式需要2人
    const minPlayers = cfg.enableMonetary ? 1 : 2;

    if (members.length < minPlayers) {
      await sendMsg(session, `👥 人数不足 ${minPlayers} 人，游戏取消。`);
      await resetGame(session.platform,channelId); // 自动退款
      return;
    }

    // 锁定状态
    await ctx.database.set("bull_card_games", { channelId }, { state: GameState.PLAYING });

    // 确定所有参与者 ID
    let allParticipants = [...members];
    if (cfg.enableMonetary) {
        // 金币模式添加 Bot 庄家
        allParticipants.push(session.bot.userId);
    }

    await sendMsg(session, `⏰ 截止！共 ${members.length} 人参与，正在发牌...`);

    // 1. 准备牌堆
    const deck = createShuffledDeck(allParticipants.length > 5 ? 4 : 2);

    // 2. 清理旧手牌记录
    await ctx.database.remove("bull_card_players", { channelId });

    // 3. 发牌并计算
    const playerResults: BullCardPlayers[] = [];

    for (const userId of allParticipants) {
      // 确定名字
      let uName = userId;
      let bet = 0;

      if (userId === session.bot.userId) {
          uName = `👑 庄家 (${session.bot.user?.name || 'Bot'})`;
      } else {
          // 玩家
          const rankData = (await ctx.database.get("bull_card_rank", { userId: userId }))[0];
          uName = rankData?.userName || userId;
          bet = game.bets?.[userId] || 0;
      }

      // 发5张
      if (deck.length < 5) {
          // 理论上前面检查过，这里防万一
          break;
      }
      const hand = deck.splice(0, 5);
      const { scoreName, scoreValue } = calculateHandValue(hand);
      const maxCard = calculateMaxCard(hand);

      const pData: BullCardPlayers = {
        channelId,
        userId,
        userName: uName,
        hand,
        resultScore: scoreValue,
        resultName: scoreName,
        maxCard,
        bet
      };

      await ctx.database.create("bull_card_players", pData);
      playerResults.push(pData);
    }

    // 4. 展示
    if (cfg.quickMode) {
        const msgLines = playerResults.map(p =>
            `${p.userName}：${visualizeDeck(p.hand)} | 【${p.resultName}】`
        );
        await sendMsg(session, `🃏 开牌结果：\n\n${msgLines.join("\n")}`);
    } else {
        for (const p of playerResults) {
            await session.send(`${p.userName} 亮牌...\n${visualizeDeck(p.hand)}\n结果：【${p.resultName}】`);
            await sleep(cfg.dealInterval);
        }
    }

    // 5. 结算
    if (cfg.enableMonetary) {
        await handleMonetarySettlement(session, playerResults);
    } else {
        await handleNormalSettlement(session, playerResults);
    }

    // 6. 结束清理
    await resetGame(session.platform,channelId, false); // false 表示不需要退款逻辑，因为已经结算过了
  }

  // --- 娱乐模式结算 (PVP) ---
  async function handleNormalSettlement(session: Session, players: BullCardPlayers[]) {
    if (players.length === 0) return;

    // 排序
    players.sort((a, b) => comparePlayers(b, a))

    // 找最大
    const topP = players[0];
    // 找并列
    const winners = players.filter(p => comparePlayers(p, topP) === 0);
    const losers = players.filter(p => !winners.includes(p));

    // 更新胜负
    for (const w of winners) {
      const r = (await ctx.database.get("bull_card_rank", { userId: w.userId }))[0];
      if (r) await ctx.database.set("bull_card_rank", { userId: w.userId }, { wins: r.wins + 1 });
    }
    for (const l of losers) {
        const r = (await ctx.database.get("bull_card_rank", { userId: l.userId }))[0];
        if (r) await ctx.database.set("bull_card_rank", { userId: l.userId }, { losses: r.losses + 1 });
    }

    const winnerNames = winners.map(w => h.at(w.userId)).join(" ");
    await sendMsg(session,
        `🎉 最终胜者：${winnerNames}${h("p", "")} ` +
        `牌型：${topP.resultName} (${topP.maxCard.suit}${topP.maxCard.rank})`
    );
  }

  // --- 金币模式结算 (PVE) ---
  async function handleMonetarySettlement(session: Session, players: BullCardPlayers[]) {
      const botPlayer = players.find(p => p.userId === session.bot.userId);
      if (!botPlayer) return; // Should not happen

      const results: string[] = [];

      for (const p of players) {
          if (p.userId === session.bot.userId) continue;

          // 比较 玩家 vs 庄家
          // comparePlayers 返回负数说明 p < bot, 正数 p > bot
          // 注意 sort 是 (a,b) => b-a 降序，所以 comparePlayers(a,b) > 0 意味着 a 强
          const diff = comparePlayers(p, botPlayer);
          const rankData = (await ctx.database.get("bull_card_rank", { userId: p.userId }))[0];
          const currentEarnings = rankData?.earnings || 0;
          const uid = (await ctx.database.getUser(session.platform, p.userId)).id;

          if (diff > 0) {
              // 玩家赢
              const multiplier = getMultiplier(p.resultScore);
              const profit = Math.floor(p.bet * multiplier);
              const totalReturn = p.bet + profit; // 本金 + 利润

              await ctx.monetary.gain(uid, totalReturn, cfg.currencyName);
              await ctx.database.set("bull_card_rank", { userId: p.userId }, {
                  earnings: currentEarnings + profit,
                  wins: (rankData?.wins || 0) + 1
              });

              results.push(`${h.at(p.userId)} 胜 (x${multiplier})，赚取 ${profit}`);
          } else if (diff < 0) {
              // 玩家输 (本金已被扣除，无需操作，只需记录亏损)
              await ctx.database.set("bull_card_rank", { userId: p.userId }, {
                  earnings: currentEarnings - p.bet,
                  losses: (rankData?.losses || 0) + 1
              });
              results.push(`${h.at(p.userId)} 败，失去 ${p.bet}`);
          } else {
              // 平局 (退还本金)
              await ctx.monetary.gain(uid, p.bet, cfg.currencyName);
              results.push(`${h.at(p.userId)} 平，退还 ${p.bet}`);
          }
      }

      await sendMsg(session, `💰 结算清单 💰${h("p", "")} ${h("p", "")}${results.join(`${h("p", "")}`)}`);
  }

  // --- 辅助函数 ---

  // 比较两个玩家牌力，A > B 返回正数
  function comparePlayers(a: BullCardPlayers, b: BullCardPlayers) {
      if (a.resultScore !== b.resultScore) return a.resultScore - b.resultScore;
      const cardA = a.maxCard;
      const cardB = b.maxCard;
      if (RANK_VALUE[cardA.rank] !== RANK_VALUE[cardB.rank])
        return RANK_VALUE[cardA.rank] - RANK_VALUE[cardB.rank];
      return SUIT_WEIGHT[cardA.suit] - SUIT_WEIGHT[cardB.suit];
  }

  // 获取倍率
  function getMultiplier(scoreValue: number): number {
      // scoreValue: 0(没牛), 1-9(牛几), 10(牛牛), 11(炸), 12(五花), 13(五小)
      if (scoreValue >= 11) return 4; // 五小牛、五花牛、炸弹
      if (scoreValue === 10) return 3; // 牛牛
      if (scoreValue >= 7) return 2; // 牛七八九
      return 1; // 其他
  }

  function clearGameTimer(channelId: string) {
        if (timers[channelId]) {
            timers[channelId]();
            delete timers[channelId];
        }
  }

  // 重置游戏，如果 refund=true 则退还所有人的下注
  async function resetGame(platform:string, channelId: string, refund: boolean = true) {
    clearGameTimer(channelId);
    const game = (await ctx.database.get("bull_card_games", { channelId }))[0];

    // 如果需要退款且开启了金币模式
    if (refund && game && cfg.enableMonetary && game.bets && ctx.monetary) {
        for (const [userId, amount] of Object.entries(game.bets)) {
            if (amount > 0) {
                try {
                    const uid = (await ctx.database.getUser(platform, userId)).id;
                    await ctx.monetary.gain(uid, amount, cfg.currencyName);
                    // 这里可以打个日志或者提示，但为了避免刷屏通常不发消息
                    logger.info(`Refunded ${amount} to user ${userId} due to game reset`);
                } catch (e) {
                    logger.error(`Refund failed for ${userId}: ${e}`);
                }
            }
        }
    }

    await ctx.database.set("bull_card_games", { channelId }, {
      state: GameState.IDLE,
      members: [],
      bets: {}, // 清空下注
      updatedAt: new Date()
    });
  }

  async function ensureRank(ctx: Context, userId: string, userName: string) {
    const ranks = await ctx.database.get("bull_card_rank", { userId });
    if (ranks.length === 0) {
      await ctx.database.create("bull_card_rank", { userId, userName: userName || userId, wins: 0, losses: 0, earnings: 0 });
    } else if (userName && ranks[0].userName !== userName) {
      await ctx.database.set("bull_card_rank", { userId }, { userName });
    }
  }

  function createShuffledDeck(numDecks: number): Card[] {
    const deck: Card[] = [];
    for (let i = 0; i < numDecks; i++) {
      for (const suit of Object.values(Suit)) {
        for (const rank of Object.values(Rank)) {
          deck.push({ suit, rank });
        }
      }
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  function visualizeDeck(hand: Card[]): string {
    return hand.map((c) => `${c.suit}${c.rank}`).join(" ");
  }

  function calculateMaxCard(hand: Card[]): Card {
    return hand.reduce((prev, curr) => {
      if (RANK_VALUE[curr.rank] > RANK_VALUE[prev.rank]) return curr;
      if (RANK_VALUE[curr.rank] === RANK_VALUE[prev.rank]) {
        if (SUIT_WEIGHT[curr.suit] > SUIT_WEIGHT[prev.suit]) return curr;
      }
      return prev;
    });
  }

  function calculateHandValue(hand: Card[]): { scoreName: string; scoreValue: number } {
    const nums = hand.map((c) => CARD_POINT[c.rank]);
    const sum = nums.reduce((a, b) => a + b, 0);

    if (isFiveSmallBull(hand, sum)) return { scoreName: "五小牛", scoreValue: 13 };
    if (isFiveFlowerBull(hand)) return { scoreName: "五花牛", scoreValue: 12 };
    if (isBomb(hand)) return { scoreName: "四炸", scoreValue: 11 };

    let maxNiu = -1;
    for (let i = 0; i < nums.length - 1; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        const twoCardSum = nums[i] + nums[j];
        if ((sum - twoCardSum) % 10 === 0) {
          let currentNiu = twoCardSum % 10;
          if (currentNiu === 0) currentNiu = 10;
          if (currentNiu > maxNiu) maxNiu = currentNiu;
        }
      }
    }

    if (maxNiu === -1) return { scoreName: "没牛", scoreValue: 0 };
    const names = ["", "牛丁", "牛二", "牛三", "牛四", "牛五", "牛六", "牛七", "牛八", "牛九", "牛牛"];
    return { scoreName: names[maxNiu], scoreValue: maxNiu };
  }

  function isFiveSmallBull(hand: Card[], sum: number) {
    return sum <= 10 && hand.every((c) => CARD_POINT[c.rank] < 5);
  }
  function isFiveFlowerBull(hand: Card[]) {
    return hand.every((c) => ["J", "Q", "K"].includes(c.rank));
  }
  function isBomb(hand: Card[]) {
    const counts = {};
    for (const c of hand) counts[c.rank] = (counts[c.rank] || 0) + 1;
    return Object.values(counts).some((c) => c === 4);
  }

  async function sendMsg(session: Session, msg: string) {
    if (cfg.atReply) {
      msg = `${h.at(session.userId)}${h("p", "")}${msg}`;
    }

    if (cfg.quoteReply) {
      msg = `${h.quote(session.messageId)}${msg}`;
    }

    await session.send(msg);
  }
}
