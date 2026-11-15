// UI wiring: run validation, render report panel, redraw canvas layers.

import { validateSeed } from "./report.js";
import { createRenderer } from "./render.js";

const canvas = document.getElementById("mapCanvas");
const renderer = createRenderer(canvas);
const reportEl = document.getElementById("report");
const legendEl = document.getElementById("legend");
const seedInput = document.getElementById("seedInput");

const layerBoxes = {
  obstacles: document.getElementById("layObstacles"),
  goals: document.getElementById("layGoals"),
  decorations: document.getElementById("layDecorations"),
  nav: document.getElementById("layNav"),
  paths: document.getElementById("layPaths"),
  diff: document.getElementById("layDiff"),
  blocker: document.getElementById("layBlocker"),
};

let current = null;

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

function renderReport(r) {
  const parts = [];

  parts.push(`<div class="card"><h2>确定性校验(3 次生成)</h2><table>
    <tr><th>层</th><th>Run1</th><th>Run2</th><th>Run3</th><th>结果</th></tr>`);
  for (const [layer, d] of Object.entries(r.determinism)) {
    const cells = d.hashes.map((h) => `<td class="mono">${h.slice(0, 8)}…</td>`).join("");
    parts.push(`<tr><td>${layer}</td>${cells}
      <td class="${d.ok ? "ok" : "bad"}">${d.ok ? "一致" : "不一致"}</td></tr>`);
  }
  parts.push(`</table><p>整体:<span class="${r.deterministic ? "ok" : "bad"}">
    ${r.deterministic ? "确定性通过" : "存在非确定性!"}</span></p></div>`);

  parts.push(`<div class="card"><h2>目标可达性(BFS)</h2><table>
    <tr><th>目标</th><th>坐标</th><th>状态</th><th>路径长度</th></tr>`);
  for (const g of r.goalResults) {
    parts.push(`<tr><td>#${g.goal.id}</td><td>(${g.goal.x}, ${g.goal.y})</td>
      <td class="${g.reachable ? "ok" : "bad"}">${g.reachable ? "可达" : "不可达"}</td>
      <td>${g.pathLength === null ? "—" : g.pathLength + " 步"}</td></tr>`);
  }
  parts.push(`</table></div>`);

  if (r.unreachable.length > 0) {
    parts.push(`<div class="card warn-box"><h2>阻断定位</h2>`);
    for (const b of r.blockers) {
      const p = b.placement;
      parts.push(`<p>目标 #${b.goal.id} (${b.goal.x}, ${b.goal.y}) 被
        <b>第 ${p.index} 次放置</b>阻断:${p.type} @ (${p.x}, ${p.y})。
        该放置完成了对目标区域的封闭。</p>`);
    }
    parts.push(`</div>`);
    if (r.fix) {
      parts.push(`<div class="card fix-box"><h2>修复建议</h2>
        <p>修复后的新 seed:<b class="mono">${esc(r.fix.seed)}</b>
        (向后搜索 ${r.fix.tries} 次,全部目标可达)</p>
        <p><button id="applyFix">应用修复 seed</button></p></div>`);
    } else {
      parts.push(`<div class="card warn-box"><p>未能在限定次数内找到修复 seed。</p></div>`);
    }
  } else {
    parts.push(`<div class="card fix-box"><h2>结论</h2>
      <p class="ok">所有目标均可达,校验通过。</p></div>`);
  }

  reportEl.innerHTML = parts.join("");

  const fixBtn = document.getElementById("applyFix");
  if (fixBtn && r.fix) {
    fixBtn.addEventListener("click", () => {
      seedInput.value = r.fix.seed;
      run();
    });
  }
}

function renderLegend() {
  const c = renderer.COLORS;
  legendEl.innerHTML = [
    [c.start, "起点"], [c.wall, "边界墙"], [c.obstacle, "障碍"],
    [c.goal, "目标"], [c.goalBad, "不可达目标"], [c.decoration[0], "装饰"],
    [c.nav, "导航节点"], [c.path, "路径"],
    [c.diffA, "差异(仅Run1)"], [c.diffB, "差异(仅RunN)"], [c.blocker, "阻断点"],
  ].map(([color, label]) => `<span><i style="background:${color}"></i>${label}</span>`).join("");
}

function redraw() {
  if (!current) return;
  const layers = {};
  for (const [k, box] of Object.entries(layerBoxes)) layers[k] = box.checked;
  renderer.draw(current, layers);
}

function run() {
  current = validateSeed(seedInput.value.trim() || "0");
  renderReport(current);
  redraw();
}

document.getElementById("runBtn").addEventListener("click", run);
seedInput.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
document.querySelectorAll(".preset").forEach((b) =>
  b.addEventListener("click", () => { seedInput.value = b.dataset.seed; run(); })
);
Object.values(layerBoxes).forEach((box) => box.addEventListener("change", redraw));

renderLegend();
run();
