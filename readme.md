# koishi-plugin-bull-card

[![github](https://img.shields.io/badge/github-araea/bull_card-8da0cb?style=for-the-badge&labelColor=555555&logo=github)](https://github.com/araea/koishi-plugin-bull-card)
[![npm](https://img.shields.io/npm/v/koishi-plugin-bull-card.svg?style=for-the-badge&color=fc8d62&logo=npm)](https://www.npmjs.com/package/koishi-plugin-bull-card)

## 介绍

Koishi 的斗牛纸牌游戏插件。

## 使用

- 发送指令 `bullCard` 查看帮助。
- 发送指令 `bullcard.来一局` 即可发起游戏。
- 其他玩家在规定时间内发送设置的暗号（默认 `1`）即可加入。
- 时间到后自动开始、发牌、结算。

## 游戏规则

-   每局五张牌，根据牌面计算结果
-   开局发三张，轮流要牌至五张
-   结果最大者胜，同分比最大单牌

## 牌面计算

-   任选三张和为 10 的倍数，剩余两张和取余 10 为结果
-   JQK 计 10，A 计 1
-   剩余两张和亦为 10 倍数：结果 10（牛牛）
-   余数非零：按余数计（牛几）
-   无三张可组 10 倍数：结果 0（没牛）

特殊情况：

-   四张同点：结果 11（四炸）
-   全为 JQK：结果 12（五花牛）
-   全 <5 且和 ≤10：结果 13（五小牛）

## 致谢

-   [Koishi](https://koishi.chat/) - 机器人框架
-   [欢乐斗牛](https://baike.baidu.com/item/%E6%AC%A2%E4%B9%90%E6%96%97%E7%89%9B/7961223) - 规则

## QQ 群

956758505

## License

_Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT) at your option._

_Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this crate by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions._
