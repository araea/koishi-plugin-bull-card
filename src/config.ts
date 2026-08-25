import { Schema } from 'koishi'

export interface Config {
  enableMonetary: boolean
  currencyName?: string
  waitTimeout: number
  entryKeyword: string
  quickMode: boolean
  dealInterval?: number
  atReply: boolean
  quoteReply: boolean
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.intersect([
    Schema.object({
      enableMonetary: Schema.boolean().default(false)
        .description('金币模式：玩家下注与 Bot 庄家比牌，需要 `monetary` 服务。关闭则为玩家互相比牌的娱乐模式。'),
    }),
    Schema.union([
      Schema.object({
        enableMonetary: Schema.const(true).required(),
        currencyName: Schema.string().default('default').description('`monetary` 的货币名称。'),
      }),
      Schema.object({}),
    ]),
  ]).description('货币设置'),

  Schema.object({
    waitTimeout: Schema.natural().min(5).default(10).description('等待玩家加入的时间（秒）。'),
    entryKeyword: Schema.string().default('1').description('加入游戏的暗号，仅娱乐模式有效。'),
  }).description('游戏设置'),

  Schema.intersect([
    Schema.object({
      quickMode: Schema.boolean().default(false).description('快速模式：一次性公布所有人的牌，不逐个亮牌。'),
    }),
    Schema.union([
      Schema.object({
        quickMode: Schema.const(false).required(),
        dealInterval: Schema.natural().default(2000).description('逐个亮牌的间隔（毫秒）。'),
      }),
      Schema.object({}),
    ]),
  ]).description('显示设置'),

  Schema.object({
    atReply: Schema.boolean().default(false).description('回复时 @ 触发者。'),
    quoteReply: Schema.boolean().default(true).description('回复时引用触发的消息。'),
  }).description('消息设置'),
]) as Schema<Config>
