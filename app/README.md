# 盲地回响 · Echo Field

只凭六段脚步回声重建路径的程序化音频测绘小游戏。无任何音频采样文件，
所有脚步与混响均由 Web Audio API 实时合成。

## 玩法

1. 点击「播放六段回声」（或按空格），按顺序聆听 I → II → III 声源之间的六段脚步。
2. 每段回声的混响（RVB）、阻尼（DMP）与声像（PAN）随真实地面材质变化。
3. 作答期间网格只显示空白节点、编号与波形，真实材质完全隐藏。
4. 把六个材质按听到的顺序拖入（或点击填入）六个节点后提交。
5. 提交后才显影真实材质：全部吻合则 `PATH CLOSED / SEED VERIFIED`；
   错位则红色标记错误节点，可重新校准再提交。

## 确定性

- 固定 seed `0x7A31C9E2`，经 mulberry32 PRNG 生成路径与材质排列，刷新结果不变。
- 该 seed 的规范答案顺序为：
  `wood → gravel → metal → stone → sand → moss`
  （木板 → 碎石 → 铁板 → 石板 → 沙地 → 苔藓）。

## 音频合成

- 每个脚步 = 带通噪声脉冲 + 低频 body thump + 金属材质附加环形振荡。
- 共享 `ConvolverNode` 卷积混响，脉冲响应为指数衰减立体声噪声；
  湿声电平按材质的 `rvb` 系数实时变化。
- 六种材质拥有互不相同的滤波频率、衰减时长、混响量、阻尼与立体声像。

## 运行

```bash
npm install
npx playwright install chromium
node e2e.mjs        # 完整端到端：正确提交 + 错误提交，输出截图与报告
node audio-check.mjs # 音频合成与零采样请求验证
```

也可用任意静态服务器打开 `index.html` 直接游玩。
