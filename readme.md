koishi-plugin-bull-card
========================

[<img alt="github" src="https://img.shields.io/badge/github-araea/bull_card-8da0cb?style=for-the-badge&labelColor=555555&logo=github" height="20">](https://github.com/araea/koishi-plugin-bull-card)
[<img alt="npm" src="https://img.shields.io/npm/v/koishi-plugin-bull-card.svg?style=for-the-badge&color=fc8d62&logo=npm" height="20">](https://www.npmjs.com/package/koishi-plugin-bull-card)

Koishi 的斗牛纸牌游戏插件。

## 使用

1. `bullCard` — 查看帮助
2. `bullcard.来一局` — 发起游戏
3. 发送暗号加入（默认 `1`）
4. 时间到，自动开始

> 仅一人加入时，Bot 陪练。

## 游戏规则

每局五张牌。

- 开局发三张
- 轮流要牌至五张
- 结果最大者胜
- 同分比最大单牌

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

## 致谢

-   [Koishi](https://koishi.chat/) - 机器人框架
-   [欢乐斗牛](https://baike.baidu.com/item/%E6%AC%A2%E4%B9%90%E6%96%97%E7%89%9B/7961223) - 规则

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
