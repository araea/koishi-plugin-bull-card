import { Random } from 'koishi'

export const SUITS = ['♠', '♥', '♣', '♦'] as const
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const

export type Suit = typeof SUITS[number]
export type Rank = typeof RANKS[number]
export interface Card { suit: Suit; rank: Rank }

/** 比大小用的牌面点数：A 最小，K 最大。 */
const value = (rank: Rank) => RANKS.indexOf(rank) + 1
/** 算牛用的点数：JQK 均计 10。 */
const point = (rank: Rank) => Math.min(value(rank), 10)
/** 同点数时的花色权重。 */
const weight = (suit: Suit) => SUITS.length - SUITS.indexOf(suit)

const NIU_NAMES = ['没牛', '牛丁', '牛二', '牛三', '牛四', '牛五', '牛六', '牛七', '牛八', '牛九', '牛牛']

export interface Hand {
  cards: Card[]
  /** 0 没牛，1 ~ 9 牛几，10 牛牛，11 四炸，12 五花牛，13 五小牛。 */
  score: number
  name: string
  /** 同分时用于比大小的最大单牌。 */
  best: Card
}

export function createDeck(decks: number): Card[] {
  const deck: Card[] = []
  for (let i = 0; i < decks; i++) {
    for (const suit of SUITS) for (const rank of RANKS) deck.push({ suit, rank })
  }
  return Random.shuffle(deck)
}

/** 五张牌里任选三张凑成 10 的倍数，余下两张的和取模即「牛几」。 */
function niu(points: number[]) {
  const sum = points.reduce((a, b) => a + b, 0)
  let best = -1
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const rest = points[i] + points[j]
      if ((sum - rest) % 10) continue
      best = Math.max(best, rest % 10 || 10)
    }
  }
  return best
}

export function evaluate(cards: Card[]): Hand {
  const points = cards.map((card) => point(card.rank))
  const best = cards.reduce((a, b) =>
    (value(b.rank) - value(a.rank) || weight(b.suit) - weight(a.suit)) > 0 ? b : a)

  const counts = new Map<Rank, number>()
  for (const { rank } of cards) counts.set(rank, (counts.get(rank) ?? 0) + 1)

  const hand = (score: number, name: string): Hand => ({ cards, score, name, best })
  if (points.every((p) => p < 5) && points.reduce((a, b) => a + b, 0) <= 10) return hand(13, '五小牛')
  if (cards.every(({ rank }) => rank === 'J' || rank === 'Q' || rank === 'K')) return hand(12, '五花牛')
  if ([...counts.values()].some((count) => count >= 4)) return hand(11, '四炸')

  const score = niu(points)
  return score < 0 ? hand(0, '没牛') : hand(score, NIU_NAMES[score])
}

/** a 大于 b 时返回正数。 */
export function compare(a: Hand, b: Hand) {
  return a.score - b.score
    || value(a.best.rank) - value(b.best.rank)
    || weight(a.best.suit) - weight(b.best.suit)
}

/** 金币模式下赢牌的赔率。 */
export function multiplier(score: number) {
  if (score >= 11) return 4 // 五小牛、五花牛、四炸
  if (score === 10) return 3 // 牛牛
  if (score >= 7) return 2 // 牛七 ~ 牛九
  return 1
}

export const format = (cards: Card[]) => cards.map(({ suit, rank }) => suit + rank).join(' ')
