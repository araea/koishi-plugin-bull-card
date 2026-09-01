import { Context, Session, h, sleep } from 'koishi'
import {} from 'koishi-plugin-monetary'
import { Card, compare, createDeck, evaluate, format, Hand, multiplier } from './cards'
import { Config } from './config'

export { Config }
export const name = 'bull-card'
export const inject = { required: ['database'], optional: ['monetary'] }

export const usage = `## 使用

\`bull.来一局\` 发起，等待时间内加入。娱乐模式发送暗号（默认 \`1\`）；金币模式发送下注金额。

## 指令

| 指令 | 说明 |
| --- | --- |
| \`bull\` | 查看帮助 |
| \`bull.来一局\` | 发起一局 |
| \`bull.排行榜 [数量]\` | 排行榜 |
| \`bull.强制结束\` | 强制重置（权限 2） |

## 牌型

每人五张牌。JQK 计 10，A 计 1；任选三张和为 10 的倍数，余数为牛几。牛牛为 10，无法组成为没牛。四炸、五花牛、五小牛为特殊牌型。

金币模式赔率：五小牛 / 五花牛 / 四炸 ×4，牛牛 ×3，牛七至牛九 ×2，其余 ×1。`

declare module 'koishi' {
  interface Tables {
    bull_card_rank: BullCardRank
  }
}

export interface BullCardRank {
  userId: string
  userName: string
  wins: number
  losses: number
  /** 金币模式的净盈亏。 */
  earnings: number
}

interface Player {
  userId: string
  userName: string
  bet: number
}

/** 一局招募中的对局，仅存在于内存里：进程退出即退款，不会留下僵尸状态。 */
interface Round {
  platform: string
  players: Map<string, Player>
  dispose: () => void
  closed: boolean
}

const RULES = `🎴 牌面规则：
• 每人五张牌，任选三张凑成 10 的倍数
• 余下两张的和取模 10 即为「牛几」，整除则为牛牛
• JQK 计 10，A 计 1，其余按牌面
• 凑不出 10 的倍数即为「没牛」

🌟 特殊牌型：四张同点为四炸，全是 JQK 为五花牛，全部小于 5 且总和不超过 10 为五小牛
📊 大小：五小牛 > 五花牛 > 四炸 > 牛牛 > 牛九 > … > 牛丁 > 没牛，同型比最大单牌（点数 > 花色）`

export function apply(root: Context, config: Config) {
  const ctx = root.guild()
  const logger = ctx.logger(name)
  const rounds = new Map<string, Round>()

  ctx.model.extend('bull_card_rank', {
    userId: 'string',
    userName: 'string',
    wins: 'unsigned',
    losses: 'unsigned',
    earnings: { type: 'double', initial: 0 },
  }, { primary: 'userId' })

  /** 按配置给回复加上引用与 @。 */
  function reply(session: Session, content: h.Fragment): h.Fragment {
    const prefix: h[] = []
    if (config.quoteReply && session.messageId) prefix.push(h.quote(session.messageId))
    if (config.atReply) prefix.push(h.at(session.userId), h('p'))
    return [...prefix, ...h.normalize(content)]
  }

  /** 取得 monetary 用的 uid，必要时补建账号，避免新用户无法下注。 */
  async function uidOf(platform: string, userId: string) {
    const user = await ctx.database.getUser(platform, userId)
    return user?.id ?? (await ctx.database.createUser(platform, userId, { authority: 1 })).id
  }

  async function balanceOf(platform: string, userId: string) {
    const uid = await uidOf(platform, userId)
    const [record] = await ctx.database.get('monetary', { uid, currency: config.currencyName })
    return { uid, value: record?.value ?? 0 }
  }

  async function refund(round: Round) {
    for (const { userId, bet } of round.players.values()) {
      if (bet <= 0) continue
      try {
        await ctx.monetary.gain(await uidOf(round.platform, userId), bet, config.currencyName)
      } catch (error) {
        logger.error('退还 %s 的 %d 失败：%s', userId, bet, error.message)
      }
    }
  }

  async function cancel(channelId: string) {
    const round = rounds.get(channelId)
    if (!round) return false
    rounds.delete(channelId)
    round.dispose()
    if (config.enableMonetary) await refund(round)
    return true
  }

  // 插件停用时把还没开牌的赌注还回去
  ctx.on('dispose', () => {
    const pending = [...rounds.values()]
    rounds.clear()
    if (config.enableMonetary) for (const round of pending) refund(round).catch(() => {})
  })

  async function track(userId: string, userName: string, delta: Partial<BullCardRank> = {}) {
    const [row] = await ctx.database.get('bull_card_rank', { userId })
    if (!row) {
      await ctx.database.create('bull_card_rank', {
        userId, userName, wins: 0, losses: 0, earnings: 0, ...delta,
      })
      return
    }
    await ctx.database.set('bull_card_rank', { userId }, {
      userName,
      wins: row.wins + (delta.wins ?? 0),
      losses: row.losses + (delta.losses ?? 0),
      earnings: row.earnings + (delta.earnings ?? 0),
    })
  }

  // 招募期间监听加入消息；不在招募中的频道只做一次 Map 查询，不碰数据库
  ctx.middleware(async (session, next) => {
    const round = rounds.get(session.channelId)
    if (!round || round.closed) return next()
    const content = session.content?.trim()
    if (!content || round.players.has(session.userId)) return next()

    let bet = 0
    if (config.enableMonetary) {
      if (!/^\d+$/.test(content)) return next()
      bet = +content
      if (!bet) return next()
      const { uid, value } = await balanceOf(session.platform, session.userId)
      if (value < bet) {
        await session.send(reply(session, `${h.at(session.userId)} ⚠️ 余额不足，你只有 ${value}。`))
        return
      }
      await ctx.monetary.cost(uid, bet, config.currencyName)
    } else if (content !== config.entryKeyword) {
      return next()
    }

    round.players.set(session.userId, { userId: session.userId, userName: session.username, bet })
    await track(session.userId, session.username)
    await session.send(reply(session, config.enableMonetary
      ? `${h.at(session.userId)} ✅ 投入 ${bet} 加入（当前 ${round.players.size} 人）。`
      : `${h.at(session.userId)} ✅ 加入成功。当前 ${round.players.size} 人。`))
  })

  const cmd = ctx.command('bull', '斗牛纸牌游戏')
    .alias('bullCard')
    .action(({ session }) => reply(session, [
      `🃏 斗牛 · ${config.enableMonetary ? '金币赌注模式' : '纯娱乐模式'}`,
      '• bull.来一局 — 发起游戏',
      '• bull.排行榜 — 查看榜单',
      '• bull.强制结束 — 强制重置并退还赌注',
      '',
      config.enableMonetary
        ? '💰 规则：Bot 作为庄家，玩家下注与庄家比牌，赢则得回本金加「赌注 × 牌型倍率」。'
        : '📋 规则：玩家之间互相比牌，最大者胜。只有一人参与时 Bot 会下场陪练。',
      '',
      RULES,
    ].join('\n')))

  cmd.subcommand('.来一局', '发起一局斗牛')
    .action(async ({ session }) => {
      const { channelId, userId, username } = session
      if (rounds.has(channelId)) return reply(session, '⚠️ 本频道已经有一局在招募，可用「bull.强制结束」重置。')

      const players = new Map<string, Player>()
      // 娱乐模式下发起人直接入座；金币模式还需要发送下注金额
      if (!config.enableMonetary) players.set(userId, { userId, userName: username, bet: 0 })

      const round: Round = {
        platform: session.platform,
        players,
        closed: false,
        dispose: ctx.setTimeout(() => settle(session), config.waitTimeout * 1000),
      }
      rounds.set(channelId, round)
      await track(userId, username)

      return reply(session, config.enableMonetary
        ? `✅ 斗牛金币局开始。\n发起人：${username}\n请在 ${config.waitTimeout} 秒内发送下注金额（纯数字）挑战庄家。`
        : `✅ 斗牛娱乐局开始。\n发起人：${username}\n请在 ${config.waitTimeout} 秒内发送「${config.entryKeyword}」加入游戏。`)
    })

  cmd.subcommand('.强制结束', '强制重置本频道的对局', { authority: 2 })
    .action(async ({ session }) => reply(session, await cancel(session.channelId)
      ? '✅ 已重置游戏状态，若有下注已退还。'
      : '⚠️ 当前没有进行中的对局。'))

  cmd.subcommand('.排行榜 [count:posint]', '查看积分榜')
    .action(async ({ session }, count = 10) => {
      const field = config.enableMonetary ? 'earnings' : 'wins'
      const list = await ctx.database
        .select('bull_card_rank')
        .orderBy(field, 'desc')
        .limit(Math.min(count, 50))
        .execute()
      if (!list.length) return reply(session, '⚠️ 暂无数据。')

      const lines = config.enableMonetary
        ? list.map((p, i) => `${i + 1}. ${p.userName}：${p.earnings >= 0 ? '📈' : '📉'} ${p.earnings}`)
        : list.map((p, i) => `${i + 1}. ${p.userName}（胜 ${p.wins} / 负 ${p.losses}）`)
      const title = config.enableMonetary ? '📋 斗牛富豪榜（净盈亏）' : '📋 斗牛胜负榜'
      return reply(session, [title, ...lines].join('\n'))
    })

  /** 招募结束：发牌、亮牌、结算。 */
  async function settle(session: Session) {
    const round = rounds.get(session.channelId)
    if (!round || round.closed) return
    round.closed = true
    rounds.delete(session.channelId)

    const players = [...round.players.values()]
    if (!players.length) {
      await session.send('⚠️ 无人参与，游戏取消。')
      return
    }

    // 金币模式必有庄家；娱乐模式只有一人时 Bot 下场陪练
    const botId = session.bot.userId
    const withBot = config.enableMonetary || players.length === 1
    const seats: Player[] = withBot
      ? [...players, { userId: botId, userName: `👑 庄家（${session.bot.user?.name || 'Bot'}）`, bet: 0 }]
      : players

    await session.send(`⏳ 截止。共 ${players.length} 人参与${withBot ? '（+Bot）' : ''}，正在发牌...`)

    const deck = createDeck(seats.length > 5 ? 4 : 2)
    const hands = new Map<Player, Hand>(seats.map((seat) => [seat, evaluate(deck.splice(0, 5) as Card[])]))

    if (config.quickMode) {
      await session.send(['📋 开牌结果：', '', ...seats.map((seat) => {
        const hand = hands.get(seat)
        return `${seat.userName}：${format(hand.cards)} |【${hand.name}】`
      })].join('\n'))
    } else {
      for (const seat of seats) {
        const hand = hands.get(seat)
        await session.send(`${seat.userName} 亮牌...\n${format(hand.cards)}\n结果：${hand.name}`)
        await sleep(config.dealInterval ?? 2000)
      }
    }

    const name = (seat: Player) => seat.userId === botId ? seat.userName : h.at(seat.userId)
    if (!config.enableMonetary) {
      const top = seats.reduce((a, b) => compare(hands.get(b), hands.get(a)) > 0 ? b : a)
      const winners = seats.filter((seat) => compare(hands.get(seat), hands.get(top)) === 0)
      for (const seat of seats) {
        if (seat.userId === botId) continue
        await track(seat.userId, seat.userName, winners.includes(seat) ? { wins: 1 } : { losses: 1 })
      }
      const best = hands.get(top)
      await session.send(`✅ 最终胜者：${winners.map(name).join(' ')}\n牌型：${best.name}（${best.best.suit}${best.best.rank}）`)
      return
    }

    const banker = hands.get(seats[seats.length - 1])
    const lines: string[] = []
    for (const seat of players) {
      const diff = compare(hands.get(seat), banker)
      const uid = await uidOf(round.platform, seat.userId)
      if (diff > 0) {
        const rate = multiplier(hands.get(seat).score)
        const profit = Math.floor(seat.bet * rate)
        await ctx.monetary.gain(uid, seat.bet + profit, config.currencyName)
        await track(seat.userId, seat.userName, { wins: 1, earnings: profit })
        lines.push(`${name(seat)} 胜（x${rate}），赚取 ${profit}`)
      } else if (diff < 0) {
        await track(seat.userId, seat.userName, { losses: 1, earnings: -seat.bet })
        lines.push(`${name(seat)} 败，失去 ${seat.bet}`)
      } else {
        await ctx.monetary.gain(uid, seat.bet, config.currencyName)
        lines.push(`${name(seat)} 平，退还 ${seat.bet}`)
      }
    }
    await session.send(['📋 结算清单', '', ...lines].join('\n'))
  }
}
