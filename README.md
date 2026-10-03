# 斗牛

Koishi 插件：斗牛牌局，支持娱乐模式与货币模式

[![GitHub](https://img.shields.io/badge/GitHub-araea%2Fkoishi--plugin--bull--card-181717?logo=github&logoColor=white)](https://github.com/araea/koishi-plugin-bull-card)
[![npm](https://img.shields.io/npm/v/koishi-plugin-bull-card?logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/koishi-plugin-bull-card)

## 安装

```sh
npm i koishi-plugin-bull-card
```

启用插件，并安装 `database` 服务。货币模式还需 `monetary` 服务。

## 快速使用

群聊与私聊均可发起。发送 `bull.来一局` 开桌，招募期内其他玩家发送 `bull.加入 [金额]` 入座。娱乐模式发暗号（默认 `1`），货币模式发下注金额。

| 指令 | 说明 |
| --- | --- |
| `bull` | 查看帮助 |
| `bull.来一局` | 发起牌局 |
| `bull.加入 [金额]` | 加入牌局，货币模式需带金额 |
| `bull.排行榜 [数量]` | 查看排行榜 |
| `bull.结束` | 重置本频道牌局；限发起者或权限 2 |
| `bull.待核对` | 查看未确认入账记录（权限 3） |
| `bull.确认入账 <编号>` | 人工核对后标记，不执行转账（权限 3） |

每人五张牌。J、Q、K 计 10 点，A 计 1 点。任取三张凑成 10 的倍数后，余数为牛几，牛牛为 10 点，凑不出称为没牛。四炸、五花牛与五小牛为特殊牌型。

大小：五小牛 > 五花牛 > 四炸 > 牛牛 > 牛九 > …… > 牛丁 > 没牛。同型比最大单牌，点数相同比花色。

货币模式赔率：五小牛、五花牛、四炸为 4 倍，牛牛为 3 倍，牛七至牛九为 2 倍，其余为 1 倍。

## 配置

| 配置项 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enableMonetary` | boolean | `false` | 货币模式，需 `monetary` 服务；关闭为娱乐模式 |
| `currencyName` | string | `default` | `monetary` 的货币名称，仅货币模式 |
| `waitTimeout` | number | `10` | 等待玩家加入的时间（秒，最小 5） |
| `entryKeyword` | string | `1` | 娱乐模式的加入暗号 |
| `enableDirectInput` | boolean | `true` | 对局中直接发送暗号或金额即可加入 |
| `quickMode` | boolean | `false` | 快速模式，一次性公布所有人的牌 |
| `dealInterval` | number | `2000` | 逐个亮牌的间隔（毫秒），仅非快速模式 |
| `atReply` | boolean | `false` | 回复时 @ 触发者 |
| `quoteReply` | boolean | `true` | 回复时引用触发的消息 |

## 限制 / 风险

货币模式转账未确认时，记录进入待核对状态。`bull.确认入账 <编号>` 只做标记，不转账，状态不明时不要重复补发。

招募期超时（`waitTimeout` 秒）自动开牌。进程退出时未完成的牌局退还金币。

娱乐模式发起人自动入座。货币模式发起人需另发下注金额。

## 链接

- [设计系统](DESIGN_SYSTEM.md)
- [MIT](LICENSE-MIT) / [Apache-2.0](LICENSE-APACHE)
