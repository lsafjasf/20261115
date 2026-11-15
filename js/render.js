// Canvas renderer with toggleable overlay layers.

import { cellKey, START } from "./mapgen.js";
import { diffLayer } from "./report.js";

const COLORS = {
  floor: "#161c26",
  grid: "#1f2733",
  wall: "#3a4657",
  obstacle: "#6b4f2a",
  goal: "#f5c542",
  goalBad: "#f87171",
  decoration: ["#2e8b6e", "#3d7ba6", "#7a5fa0"],
  nav: "#3f5a78",
  path: "#4ade80",
  start: "#e8eef5",
  diffA: "rgba(255, 80, 80, 0.55)",
  diffB: "rgba(80, 160, 255, 0.55)",
  blocker: "#ff2d55",
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");

  function draw(result, layers) {
    const map = result.runs[0].map;
    const cw = canvas.width / map.width;
    const ch = canvas.height / map.height;

    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= map.width; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cw, 0);
      ctx.lineTo(x * cw, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= map.height; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * ch);
      ctx.lineTo(canvas.width, y * ch);
      ctx.stroke();
    }

    if (layers.obstacles) {
      for (const k of map.obstacles) {
        const [x, y] = k.split(",").map(Number);
        const isWall =
          x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;
        ctx.fillStyle = isWall ? COLORS.wall : COLORS.obstacle;
        ctx.fillRect(x * cw + 1, y * ch + 1, cw - 2, ch - 2);
      }
    }

    if (layers.decorations) {
      for (const d of map.decorations) {
        ctx.fillStyle = COLORS.decoration[d.kind % COLORS.decoration.length];
        ctx.beginPath();
        ctx.arc((d.x + 0.5) * cw, (d.y + 0.5) * ch, cw * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (layers.nav) {
      ctx.fillStyle = COLORS.nav;
      for (const n of map.navNodes) {
        ctx.fillRect((n.x + 0.5) * cw - 2, (n.y + 0.5) * ch - 2, 4, 4);
      }
    }

    if (layers.paths) {
      for (const r of result.goalResults) {
        if (!r.path) continue;
        ctx.strokeStyle = COLORS.path;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        r.path.forEach((p, i) => {
          const px = (p.x + 0.5) * cw;
          const py = (p.y + 0.5) * ch;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Start marker.
    ctx.fillStyle = COLORS.start;
    ctx.beginPath();
    ctx.arc((START.x + 0.5) * cw, (START.y + 0.5) * ch, cw * 0.28, 0, Math.PI * 2);
    ctx.fill();

    if (layers.goals) {
      for (const r of result.goalResults) {
        const g = r.goal;
        ctx.fillStyle = r.reachable ? COLORS.goal : COLORS.goalBad;
        ctx.beginPath();
        const cx = (g.x + 0.5) * cw;
        const cy = (g.y + 0.5) * ch;
        ctx.moveTo(cx, cy - ch * 0.32);
        ctx.lineTo(cx + cw * 0.32, cy);
        ctx.lineTo(cx, cy + ch * 0.32);
        ctx.lineTo(cx - cw * 0.32, cy);
        ctx.closePath();
        ctx.fill();
      }
    }

    if (layers.diff) {
      // Overlay cell diffs between run 1 and run 2/3 across all layers.
      const marks = [];
      for (const layer of ["obstacles", "goals", "decorations", "navNodes"]) {
        for (let i = 1; i < result.runs.length; i++) {
          const d = diffLayer(result.runs[0].map, result.runs[i].map, layer);
          for (const k of d.onlyA) marks.push({ k, color: COLORS.diffA });
          for (const k of d.onlyB) marks.push({ k, color: COLORS.diffB });
        }
      }
      for (const m of marks) {
        const [x, y] = m.k.split(",").map(Number);
        ctx.fillStyle = m.color;
        ctx.fillRect(x * cw + 2, y * ch + 2, cw - 4, ch - 4);
      }
    }

    if (layers.blocker) {
      for (const b of result.blockers) {
        if (!b.placement) continue;
        ctx.strokeStyle = COLORS.blocker;
        ctx.lineWidth = 3;
        ctx.strokeRect(
          b.placement.x * cw + 1.5,
          b.placement.y * ch + 1.5,
          cw - 3,
          ch - 3
        );
        ctx.beginPath();
        ctx.moveTo(b.placement.x * cw + 3, b.placement.y * ch + 3);
        ctx.lineTo((b.placement.x + 1) * cw - 3, (b.placement.y + 1) * ch - 3);
        ctx.moveTo((b.placement.x + 1) * cw - 3, b.placement.y * ch + 3);
        ctx.lineTo(b.placement.x * cw + 3, (b.placement.y + 1) * ch - 3);
        ctx.stroke();
      }
    }
  }

  return { draw, COLORS };
}
