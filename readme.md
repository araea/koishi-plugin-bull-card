koishi-plugin-bull-card
========================

[<img alt="github" src="https://img.shields.io/badge/github-araea/koishi__plugin__bull__card-8da0cb?style=for-the-badge&labelColor=555555&logo=github" height="20">](https://github.com/araea/koishi-plugin-bull-card)
[<img alt="npm" src="https://img.shields.io/npm/v/koishi-plugin-bull-card.svg?style=for-the-badge&color=fc8d62&logo=npm" height="20">](https://www.npmjs.com/package/koishi-plugin-bull-card)

Koishi 的斗牛纸牌游戏插件。

## 使用

`bull.来一局` 发起，等待时间内加入。娱乐模式发送暗号（默认 `1`）；金币模式发送下注金额。

## 指令

| 指令 | 说明 |
| --- | --- |
| `bull` | 查看帮助 |
| `bull.来一局` | 发起一局 |
| `bull.排行榜 [数量]` | 排行榜 |
| `bull.强制结束` | 强制重置（权限 2） |

## 牌型

每人五张牌。JQK 计 10，A 计 1；任选三张和为 10 的倍数，余数为牛几。牛牛为 10，无法组成为没牛。四炸、五花牛、五小牛为特殊牌型。

金币模式赔率：五小牛 / 五花牛 / 四炸 ×4，牛牛 ×3，牛七至牛九 ×2，其余 ×1。

## QQ 群

956758505

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
