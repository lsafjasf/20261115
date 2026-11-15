// 共享演示数据：障碍物时间线 + 字幕（浏览器与 Node 验证脚本共用）
// 坐标均为归一化值（0..1），基于 960x540 画面。
(function (root, factory) {
  const data = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = data;
  else root.DEMO = data;
})(typeof self !== "undefined" ? self : this, function () {
  // 安全区：四边各留 5%
  const SAFE = { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };

  // 障碍物：type 为 face / product / logo；rect 可为静态对象或 rect(t) 函数
  const obstacles = [
    {
      id: "logo",
      type: "logo",
      label: "台标",
      t0: 0,
      t1: 15,
      rect: { x: 0.86, y: 0.06, w: 0.1, h: 0.08 },
    },
    {
      id: "face",
      type: "face",
      label: "人脸",
      t0: 0,
      t1: 15,
      // 人脸 10s 后从上方下移到画面底部中央
      rect: function (t) {
        const y = t < 10 ? 0.12 : 0.12 + (t - 10) * 0.14;
        const x = 0.4 + 0.08 * Math.sin(t * 0.8);
        return { x: x, y: Math.min(y, 0.68), w: 0.2, h: 0.24 };
      },
    },
    {
      id: "product",
      type: "product",
      label: "商品信息",
      t0: 3,
      t1: 8.5,
      rect: { x: 0.08, y: 0.78, w: 0.5, h: 0.16 }, // 底部商品横幅
    },
    {
      id: "price",
      type: "product",
      label: "价格角标",
      t0: 8.5,
      t1: 11,
      rect: { x: 0.68, y: 0.8, w: 0.24, h: 0.12 },
    },
  ];

  // 五条字幕：priority 越大越优先保住理想位置
  const subtitles = [
    { id: 1, text: "大家好，欢迎来到今天的测评", start: 0.5, end: 2.8, priority: 3, fontSize: 28 },
    { id: 2, text: "这款耳机的降噪效果非常出色", start: 3.0, end: 5.5, priority: 4, fontSize: 28 },
    { id: 3, text: "价格只要 199，链接在评论区", start: 6.0, end: 8.2, priority: 5, fontSize: 28 },
    { id: 4, text: "续航能达到 30 小时左右", start: 8.6, end: 11.0, priority: 2, fontSize: 28 },
    { id: 5, text: "喜欢的话记得点赞关注", start: 11.5, end: 14.0, priority: 3, fontSize: 28 },
  ];

  // 字幕默认理想锚点（中心点，归一化）：底部居中
  const PREFERRED = { x: 0.5, y: 0.88 };

  return { SAFE, obstacles, subtitles, PREFERRED, DURATION: 15 };
});
