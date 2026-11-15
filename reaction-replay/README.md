# 反应游戏 · 可验证对局回放

一个单屏反应小游戏：目标随机出现并带 TTL 倒计时环，玩家点击命中得分、点空扣分。
对局按固定 tick（30 tick/s，共 600 tick）推进，逐 tick 记录输入、随机数状态、
游戏状态与事件，并以哈希链串联。结束后可把记录的输入流重放到**全新初始状态**，
逐 tick 比对终态与得分摘要；若摘要不符，定位并高亮**首次分叉的 tick**。

## 可验证性设计

- **确定性引擎**：`src/engine.js` 无 DOM 依赖，给定 `seed` 与输入流，结果完全可复现。
- **可序列化随机数**：`src/rng.js` 为 mulberry32，32 位状态随每条日志记录 `rngBefore/rngAfter`。
- **逐 tick 日志**：每条记录含 `tick`、`input`、`rngBefore`、`rngAfter`、`state`、`events`、`hash`。
- **哈希链**：`hash = FNV-1a(本条内容, 上一条 hash)`，任何对历史记录的篡改都会从该条起断链。
- **双路校验**（`src/recorder.js` 的 `replayAndVerify`）：
  1. 结构校验：重算哈希链，找到首个被篡改的条目；
  2. 行为校验：用相同 seed 新建引擎重放全部输入，逐字段比对状态，找到首次分叉 tick。
- **终态摘要**：`summary` 记录最终得分、命中/失误、tick 数与链末哈希，重放后核对一致性。

## 目录结构

```
reaction-replay/
├── index.html            # 双 Canvas 界面入口
├── package.json
├── src/
│   ├── engine.js         # 纯游戏引擎（固定 tick、确定性）
│   ├── rng.js            # mulberry32 确定性随机数
│   ├── recorder.js       # 记录器、哈希链、重放与分叉检测
│   ├── bot.js            # 自动玩家（Node 演示与默认自动对局）
│   ├── renderer.js       # Canvas 渲染（实时/重放共用，支持分叉高亮）
│   ├── audio.js          # Web Audio 操作反馈
│   ├── app.js            # 浏览器主程序：游戏循环与 UI 联动
│   └── style.css
└── verify/
    ├── demo.mjs          # Node 端：完整一局 → 重放 → 篡改 → 断言
    ├── game-log.json     # 演示生成的完整对局日志
    ├── replay-report.json
    └── tamper-report.json
```

## 运行方式

Node 端一键验证（完成一局、重放、篡改、断言）：

```bash
npm run demo        # 等价于 node verify/demo.mjs
```

浏览器端（需要静态服务器以支持 ES Module）：

```bash
npm run serve       # 然后打开 http://localhost:8731/index.html
```

界面操作：

- **开始 / 自动对局**：自动玩家完成一局；也可在左画布点击接管为手动操作。
- **从初始状态重放**：新建同 seed 引擎重放全部输入，右侧画布按真实 tick 速度播放。
- **篡改一条记录**：把第 200 条（tick 200）输入改为 `(40,40)` 点击，再重放。
- **校验当前日志**：恢复对原始日志的重放校验。

Web Audio 提供命中（双音上扬）、失误（低频锯齿）、目标到期、对局完成、分叉警报等反馈。

## 已验证结果

`node verify/demo.mjs` 输出（seed=20261115，600 ticks）：

- 干净对局：得分 356，命中 27，失误 0，哈希链完整，重放无分叉，摘要一致。
- 篡改 tick 200 的输入后：
  - 哈希链首个损坏条目 `firstBadTick = 200`；
  - 行为重放首次分叉 `firstDivergence.tick = 200`（记录 score=118 vs 重放 score=116）；
  - 终态得分变为 354，与摘要 356 不符，日志标记为不可信。
- 六项断言全部 `PASS`；另经无头 Chromium 冒烟测试，双画布、徽章、红框分叉高亮、
  手动点击与零控制台错误均通过。
