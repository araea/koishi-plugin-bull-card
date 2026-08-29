koishi-plugin-bull-card
========================

[<img alt="github" src="https://img.shields.io/badge/github-araea/bull_card-8da0cb?style=for-the-badge&labelColor=555555&logo=github" height="20">](https://github.com/araea/koishi-plugin-bull-card)
[<img alt="npm" src="https://img.shields.io/npm/v/koishi-plugin-bull-card.svg?style=for-the-badge&color=fc8d62&logo=npm" height="20">](https://www.npmjs.com/package/koishi-plugin-bull-card)

Koishi 的斗牛纸牌游戏插件。

## 使用

1. `bullCard` — 查看帮助
2. `bullCard.来一局` — 发起游戏
3. 在等待时间内加入
4. 时间到，自动发牌结算

## 两种模式

| 模式 | 加入方式 | 玩法 |
|------|----------|------|
| 娱乐模式（默认） | 发送暗号（默认 `1`） | 玩家之间互相比牌，最大者胜。只有一人时 Bot 下场陪练 |
| 金币模式 | 发送下注金额（纯数字） | 与 Bot 庄家单挑，赢则得回本金加「赌注 × 牌型倍率」 |

> 金币模式需要 `monetary` 服务。下注在加入时即扣除，平局退还；对局取消或插件停用时也会退还。

## 指令

| 指令 | 说明 |
| --- | --- |
| `bullCard` | 查看帮助与规则 |
| `bullCard.来一局` | 发起一局 |
| `bullCard.排行榜 [数量]` | 娱乐模式看胜负榜，金币模式看净盈亏榜 |
| `bullCard.强制结束` | 强制重置本频道对局并退还赌注（需 2 级权限） |

## 游戏规则

每人五张牌，一次发齐，结果最大者胜，同型比最大单牌（点数 > 花色）。

## 牌面计算

**基础**

- JQK 计 10，A 计 1
- 任选三张和为 10 的倍数
- 剩余两张和取余 10 为结果

**结果**

| 条件 | 结果 |
|------|------|
| 剩余两张和亦为 10 倍数 | 10（牛牛） |
| 余数非零 | 余数（牛几） |
| 无法组成 10 倍数 | 0（没牛） |

**特殊**

| 条件 | 结果 |
|------|------|
| 四张同点 | 11（四炸） |
| 全为 JQK | 12（五花牛） |
| 全 <5 且和 ≤10 | 13（五小牛） |

## 金币模式赔率

| 牌型 | 赔率 |
|------|------|
| 五小牛 / 五花牛 / 四炸 | x4 |
| 牛牛 | x3 |
| 牛七 ~ 牛九 | x2 |
| 牛一 ~ 牛六 / 没牛 | x1 |

## 致谢

- [Koishi](https://koishi.chat/)
- [欢乐斗牛](https://baike.baidu.com/item/%E6%AC%A2%E4%B9%90%E6%96%97%E7%89%9B/7961223)

## QQ 群

- 956758505

<br>

#### License

<sup>
Licensed under either of <a href="LICENSE-APACHE">Apache License, Version
2.0</a> or <a href="LICENSE-MIT">MIT license</a> at your option.
</sup>

<br>

<sub>
Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in this crate by you, as defined in the Apache-2.0 license, shall
be dual licensed as above, without any additional terms or conditions.
</sub>
