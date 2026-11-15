// Node 验证：真实跑 5 条字幕的避让布局，并验证无解回退建议
const DEMO = require("../data.js");
const E = require("../avoid.js");

const W = 960, H = 540;
const { SAFE, obstacles, PREFERRED } = DEMO;
// 深拷贝字幕，避免污染
const subtitles = JSON.parse(JSON.stringify(DEMO.subtitles));

// Node 环境的文本测量（与浏览器近似：CJK 全宽，ASCII 半宽）
function measure(text, fontSize) {
  let w = 0;
  for (const ch of text) w += ch.codePointAt(0) > 255 ? fontSize : fontSize * 0.55;
  return { w: w + 24, h: fontSize + 16 };
}

let failures = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

// ---- 1. 布局 5 条字幕 ----
E.layoutSubtitles(subtitles, obstacles, {
  measure, safe: E.normToPx(SAFE, W, H), W, H, preferred: PREFERRED,
});

check("5 条字幕全部完成布局", subtitles.every((s) => s._rect));
check("无字幕处于无解(stuck)状态", subtitles.every((s) => !s._stuck));

// ---- 2. 碰撞校验：字幕 vs 障碍物（整窗采样）& 字幕 vs 字幕 ----
function collidesWithObstacles(sub) {
  for (let t = sub.start; t <= sub.end + 1e-6; t += 0.25) {
    for (const ob of E.activeObstacles(obstacles, t, W, H)) {
      if (E.rectsOverlap(sub._rect, ob.rect)) return ob.label;
    }
  }
  return null;
}
for (const sub of subtitles) {
  check(`字幕 #${sub.id} 不碰撞任何障碍物`, !collidesWithObstacles(sub), collidesWithObstacles(sub) || "");
}
for (let i = 0; i < subtitles.length; i++) {
  for (let j = i + 1; j < subtitles.length; j++) {
    const a = subtitles[i], b = subtitles[j];
    if (a.start > b.end || b.start > a.end) continue;
    check(`字幕 #${a.id} 与 #${b.id} 互不重叠`, !E.rectsOverlap(a._rect, b._rect));
  }
}

// ---- 3. 至少一处自动避让 ----
const avoided = subtitles.filter((s) => s._avoided);
check("至少一处自动避让", avoided.length >= 1,
  avoided.map((s) => `#${s.id} 移至 (${s.pos.x.toFixed(2)}, ${s.pos.y.toFixed(2)})`).join("; "));
for (const s of avoided) {
  const d = Math.hypot(s.pos.x - PREFERRED.x, s.pos.y - PREFERRED.y);
  console.log(`      字幕 #${s.id}「${s.text}」偏离理想位 ${(d * 100).toFixed(0)}% 画面`);
}

// ---- 4. 无解场景：必须给出缩小字号/延长显示建议 ----
// 构造：障碍物盖住安全区 y>=150px 的全部区域，60px 大字号无处可放（缩小后可放）
const wall = [{ id: "wall", type: "product", label: "墙", t0: 0, t1: 10, rect: { x: 0.05, y: 150 / 540, w: 0.9, h: 1 } }];
const bigSub = { id: 99, text: "这条字幕字号太大根本放不下", start: 1, end: 3, priority: 1, fontSize: 60 };
const bigSize = measure(bigSub.text, bigSub.fontSize);
const safePx = E.normToPx(SAFE, W, H);
const blockers = E.activeObstacles(wall, 1.5, W, H);
const none = E.findPlacement({ size: bigSize, blockers, safe: safePx, W, H, preferred: PREFERRED });
check("大字号场景确认无可行位置", none === null);

const suggestions = E.fallbackSuggestions({
  text: bigSub.text, fontSize: bigSub.fontSize, start: bigSub.start, end: bigSub.end,
  measure, blockers, safe: safePx, W, H, preferred: PREFERRED,
  makeBlockers: (t0, t1) => {
    const out = [];
    for (let t = t0; t <= t1 + 1e-6; t += 0.25) out.push(...E.activeObstacles(wall, t, W, H));
    return out;
  },
});
check("无解时给出缩小字号建议", suggestions.some((s) => s.kind === "shrink"),
  (suggestions.find((s) => s.kind === "shrink") || {}).fontSize + "px");

// 延长场景：障碍物 5s 后消失，延长显示应找到尾部窗口
const tempWall = [{ id: "tw", type: "product", label: "临时", t0: 0, t1: 5, rect: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 } }];
const sug2 = E.fallbackSuggestions({
  text: "测试字幕", fontSize: 28, start: 3, end: 5, measure,
  blockers: E.activeObstacles(tempWall, 3, W, H), safe: safePx, W, H, preferred: PREFERRED,
  makeBlockers: (t0, t1) => {
    const out = [];
    for (let t = t0; t <= t1 + 1e-6; t += 0.25) out.push(...E.activeObstacles(tempWall, t, W, H));
    return out;
  },
});
check("无解时给出延长显示建议", sug2.some((s) => s.kind === "extend"),
  JSON.stringify(sug2.find((s) => s.kind === "extend") || {}, (k, v) => (k === "placement" ? "..." : v)));

console.log(failures === 0 ? "\n全部验证通过 ✅" : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
