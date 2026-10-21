# 学习卡评分后立即重复的问题

App 会在每次评分成功后重新获取后端队列。之前后端将所有进入 learn-ahead 窗口的学习/重学卡放到队首，因此新卡点“忘记/困难/良好”后，即使下一次到期尚有几分钟，也会抢在其他复习卡和新卡之前再次显示。旧 App 先消费当前批次，直到批次结束再加载，因而没有立即暴露这个排序问题。

现将日内学习卡分成已到期与允许提前学习两类。队列顺序为：已到期学习/重学卡、复习/跨天学习卡、新卡、提前学习窗口内的未到期学习卡。最后一类仍按到期时间排序。卡片候选范围、日限额、队列数量和 FSRS 评分间隔保持原语义；没有修改数据库中的卡片、复习日志或学习设置。

如果其他可学卡已经做完，剩余学习卡仍可能提前出现，这是默认 20 分钟 learn-ahead 窗口的行为。与 [Anki 官方说明](https://github.com/ankitects/anki/blob/main/docs-site/manual/preferences.mdx#scheduler) 一致，提前学习应在没有其他可学卡时使用。

验证：

```sh
npm run typecheck --prefix server
node --test server/scripts/tests/due-order.cjs server/scripts/tests/deck-clock.cjs
npm run prod:build --prefix server
```

`due-order.cjs` 使用模拟仓储与真实 FSRS 计算，不连接数据库。覆盖非 Easy 三种评分、实际延迟到期前后、复习/新卡优先级、提前学习内部顺序、零额度、仅剩学习卡以及数量兼容；修复前四个回归用例失败，修复后全部通过。
