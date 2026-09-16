import { Context, Session, h, sleep } from 'koishi'
import {} from 'koishi-plugin-monetary'
import { Card, compare, createDeck, evaluate, format, Hand, multiplier } from './cards'
import { Config } from './config'

export { Config }
export const name = 'bull-card'
export const inject = { required: ['database'], optional: ['monetary'] }

export const usage = `## 使用

群聊与私聊均可用。发送 \`bull.来一局\` 发起，等待期间加入：娱乐模式发暗号（默认 \`1\`），金币模式发下注金额。

## 指令

| 指令 | 说明 |
| --- | --- |
| \`bull\` | 帮助 |
| \`bull.来一局\` | 发起一局 |
| \`bull.加入 [金额]\` | 加入招募中的对局，金币模式需带上金额 |
| \`bull.排行榜 [数量]\` | 排行榜 |
| \`bull.结束\` | 重置本频道的对局，发起者或权限 2 |

## 牌型

每人五张牌。J、Q、K 计 10 点，A 计 1 点；任取三张凑成 10 的倍数后，余数为牛几，牛牛为 10 点，凑不出称为没牛。四炸、五花牛、五小牛为特殊牌型。

大小：五小牛 > 五花牛 > 四炸 > 牛牛 > 牛九 > …… > 牛丁 > 没牛，同型比最大单牌，点数相同比花色。

金币模式赔率：五小牛、五花牛、四炸 ×4，牛牛 ×3，牛七至牛九 ×2，其余 ×1。`

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
  /** 发起这一局的人；重置他人对局要卡在这里。 */
  ownerId: string
  players: Map<string, Player>
  dispose: () => void
  closed: boolean
}

export function apply(root: Context, config: Config) {
  const ctx = root
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

  /** 招募期的加入锁：扣款与入座之间可能被结算插队。 */
  const joining = new Set<string>()

  /**
   * 加入当前招募中的对局。返回 null 表示这条消息不属于本插件。
   * 娱乐模式忽略金额，金币模式的金额由裸词或参数给出。
   */
  async function joinRound(session: Session, amount?: number): Promise<h.Fragment | null> {
    const round = rounds.get(session.channelId)
    if (!round || round.closed) return null

    let bet = 0
    let uid = 0
    if (config.enableMonetary) {
      if (!amount || amount <= 0) return null
      bet = amount
      const balance = await balanceOf(session.platform, session.userId)
      uid = balance.uid
      if (balance.value < bet) {
        return reply(session, `${h.at(session.userId)} ⚠️ 余额不足\n下注 ${bet} 还差 ${bet - balance.value}，当前余额 ${balance.value}。`)
      }
    }

    if (joining.has(session.channelId)) return reply(session, '⏳ 正在处理上一位加入，稍后再发。')
    joining.add(session.channelId)
    try {
      // 读余额到扣款之间这一局可能已经结算，扣款前再确认一次
      if (!rounds.has(session.channelId) || round.closed) {
        return reply(session, '💡 这一局刚刚收场\n发送「bull.来一局」发起新的一局。')
      }
      if (config.enableMonetary) await ctx.monetary.cost(uid, bet, config.currencyName)
      // 扣款期间结算或重置插进来时这一局已经作废，人进不去，钱要还回去
      if (!rounds.has(session.channelId) || round.closed) {
        if (config.enableMonetary) {
          try {
            await ctx.monetary.gain(uid, bet, config.currencyName)
          } catch (error) {
            logger.error('退还 %s 的 %d 失败：%s', session.userId, bet, error.message)
          }
        }
        return reply(session, '💡 这一局刚刚收场\n发送「bull.来一局」发起新的一局。')
      }
      round.players.set(session.userId, { userId: session.userId, userName: session.username, bet })
      await track(session.userId, session.username)
      return reply(session, config.enableMonetary
        ? `${h.at(session.userId)} ✅ 投入 ${bet} 加入（当前 ${round.players.size} 人）。`
        : `${h.at(session.userId)} ✅ 加入成功。当前 ${round.players.size} 人。`)
    } finally {
      joining.delete(session.channelId)
    }
  }

  // 招募期间监听加入消息；不在招募中的频道只做一次 Map 查询，不碰数据库
  ctx.middleware(async (session, next) => {
    if (!config.enableDirectInput) return next()
    const round = rounds.get(session.channelId)
    if (!round || round.closed) return next()
    const content = session.content?.trim()
    if (!content || round.players.has(session.userId)) return next()

    // 金币模式只认纯数字，娱乐模式只认暗号；其余交给别的插件
    const monetary = config.enableMonetary
    if (monetary ? !/^[1-9]\d*$/.test(content) : content !== config.entryKeyword) return next()

    const reply = await joinRound(session, monetary ? +content : undefined)
    if (!reply) return next()
    await session.send(reply)
  })

  const cmd = ctx.command('bull', '斗牛纸牌游戏')
    .alias('bullCard')
    .action(({ session }) => session.execute('help bull'))

  cmd.subcommand('.来一局', '发起一局斗牛')
    .action(async ({ session }) => {
      const { channelId, userId, username } = session
      if (rounds.has(channelId)) return reply(session, '⚠️ 本频道已经有一局在招募\n发送「bull.结束」重置，再开新的。')

      const players = new Map<string, Player>()
      // 娱乐模式下发起人直接入座；金币模式还需要发送下注金额
      if (!config.enableMonetary) players.set(userId, { userId, userName: username, bet: 0 })

      const round: Round = {
        platform: session.platform,
        ownerId: userId,
        players,
        closed: false,
        dispose: ctx.setTimeout(() => settle(session), config.waitTimeout * 1000),
      }
      rounds.set(channelId, round)
      await track(userId, username)

      return reply(session, config.enableMonetary
        ? `✅ 斗牛金币局开始\n发起人：${username}\n请在 ${config.waitTimeout} 秒内发送下注金额（纯数字）挑战庄家。`
        : `✅ 斗牛娱乐局开始\n发起人：${username}\n请在 ${config.waitTimeout} 秒内发送「${config.entryKeyword}」加入对局。`)
    })

  cmd.subcommand('.结束', '重置本频道的对局')
    .userFields(['id', 'name', 'authority'])
    .action(async ({ session }) => {
      const round = rounds.get(session.channelId)
      if (!round) return reply(session, '💡 本频道没有进行中的对局\n发送「bull.来一局」发起一局。')
      const authority = session.user?.authority ?? 0
      if (session.userId !== round.ownerId && authority < 2) {
        return reply(session, '⚠️ 权限不够\n只有发起者或权限 2 以上的人能重置这一局。')
      }
      await cancel(session.channelId)
      return reply(session, '✅ 已重置本频道的对局，下注已退还。')
    })

  cmd.subcommand('.加入 [bet:posint]', '加入招募中的对局')
    .action(async ({ session }, bet) => {
      const round = rounds.get(session.channelId)
      if (!round || round.closed) return reply(session, '💡 本频道没有在招募的对局\n发送「bull.来一局」发起一局。')
      if (round.players.has(session.userId)) return reply(session, '⏳ 你已经在牌桌上\n等这一局开牌。')
      if (config.enableMonetary && !bet) return reply(session, '⚠️ 金币模式要写下注金额\n例：「bull.加入 100」。')
      const result = await joinRound(session, bet)
      return result ?? reply(session, '💡 这一局刚刚收场\n发送「bull.来一局」发起新的一局。')
    })

  cmd.subcommand('.排行榜 [count:posint]', '查看积分排行榜')
    .action(async ({ session }, count = 10) => {
      const field = config.enableMonetary ? 'earnings' : 'wins'
      const list = await ctx.database
        .select('bull_card_rank')
        .orderBy(field, 'desc')
        .limit(Math.min(count, 50))
        .execute()
      if (!list.length) return reply(session, '📋 排行榜还空着\n第一个坐上牌桌的人，名字会写在这里。\n发送「bull.来一局」发起一局。')

      const shown = list.slice(0, 4)
      const lines = config.enableMonetary
        ? shown.map((p, i) => `${i + 1}. ${p.userName}：${p.earnings >= 0 ? '📈' : '📉'} ${p.earnings}`)
        : shown.map((p, i) => `${i + 1}. ${p.userName}（胜 ${p.wins} / 负 ${p.losses}）`)
      const hidden = list.length - shown.length
      if (hidden > 0) lines.push(`…… 另有 ${hidden} 人未列`)
      const title = config.enableMonetary ? '📋 斗牛富豪排行榜（净盈亏）' : '📋 斗牛胜负排行榜'
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
      await session.send('💡 无人入座，这一局作罢\n发送「bull.来一局」再发起一次。')
      return
    }

    // 金币模式必有庄家；娱乐模式只有一人时 Bot 下场陪练
    const botId = session.bot.userId
    const withBot = config.enableMonetary || players.length === 1
    const seats: Player[] = withBot
      ? [...players, { userId: botId, userName: `👑 庄家（${session.bot.user?.name || 'Bot'}）`, bet: 0 }]
      : players

    await session.send(`⏳ 招募截止 · 共 ${players.length} 人入座${withBot ? '（含 Bot）' : ''}\n正在发牌……`)

    const deck = createDeck(seats.length > 5 ? 4 : 2)
    const hands = new Map<Player, Hand>(seats.map((seat) => [seat, evaluate(deck.splice(0, 5) as Card[])]))

    if (config.quickMode) {
      await session.send(['📋 开牌结果：', '', ...seats.map((seat) => {
        const hand = hands.get(seat)
        return `${seat.userName}：${format(hand.cards)} · ${hand.name}`
      })].join('\n'))
    } else {
      for (const seat of seats) {
        const hand = hands.get(seat)
        await session.send(`${seat.userName} 亮牌……\n${format(hand.cards)}\n结果：${hand.name}`)
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
      await session.send(`🏆 最终胜者：${winners.map(name).join(' ')}\n牌型：${best.name}（${best.best.suit}${best.best.rank}）`)
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
