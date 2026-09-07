# koishi-plugin-bull-card

斗牛纸牌游戏插件，支持娱乐模式和金币模式。

## 安装

~~~sh
yarn add koishi-plugin-bull-card
~~~

在 Koishi 配置中启用 koishi-plugin-bull-card，并提供 database 服务。金币模式需要 monetary 服务。

## 使用

群聊和私聊均可使用。发送 bull.来一局 发起游戏，等待期间加入；娱乐模式发送暗号，
金币模式发送下注金额。

| 指令 | 说明 |
| --- | --- |
| bull | 查看帮助 |
| bull.来一局 | 发起一局 |
| bull.排行榜 [数量] | 查看排行榜 |
| bull.强制结束 | 强制结束当前游戏，权限等级 2 |

每人五张牌。J、Q、K 计 10 点，A 计 1 点；任选三张牌凑成 10 的倍数后，余数为牛几。
牛牛为 10 点，无法组成称为没牛。四炸、五花牛、五小牛为特殊牌型。

金币模式赔率：五小牛、五花牛、四炸 ×4；牛牛 ×3；牛七至牛九 ×2；其余 ×1。

## 许可证

可按 [Apache-2.0](LICENSE-APACHE) 或 [MIT](LICENSE-MIT) 使用。
