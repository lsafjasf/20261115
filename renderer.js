import { BUILDINGS, COLS, LAND_COLS, ROWS, getMetrics } from "./simulation.js";

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function mixColor(from, to, amount) {
  const a = from.match(/\w\w/g).map((value) => Number.parseInt(value, 16));
  const b = to.match(/\w\w/g).map((value) => Number.parseInt(value, 16));
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function terrainColor(elevation) {
  const amount = Math.max(0, Math.min(1, (elevation - 2.8) / 2));
  return mixColor("233c36", "403f2d", amount);
}

export class MapRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.world = { x: 0, y: 0, width: 0, height: 0, cell: 1 };
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(320, rect.width);
    this.height = Math.max(280, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const padX = this.width < 520 ? 11 : 22;
    const padTop = 25;
    const padBottom = 29;
    const availableW = this.width - padX * 2;
    const availableH = this.height - padTop - padBottom;
    const cell = Math.max(8, Math.min(availableW / COLS, availableH / ROWS));
    const mapW = cell * COLS;
    const mapH = cell * ROWS;
    this.world = {
      x: (this.width - mapW) / 2,
      y: padTop + (availableH - mapH) / 2,
      width: mapW,
      height: mapH,
      cell,
    };
  }

  cellRect(c, r) {
    const { x, y, cell } = this.world;
    return { x: x + c * cell, y: y + r * cell, width: cell, height: cell };
  }

  fromClient(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * this.width,
      y: ((clientY - rect.top) / rect.height) * this.height,
    };
  }

  cellFromClient(clientX, clientY) {
    const point = this.fromClient(clientX, clientY);
    const c = Math.floor((point.x - this.world.x) / this.world.cell);
    const r = Math.floor((point.y - this.world.y) / this.world.cell);
    if (c < 0 || c >= LAND_COLS || r < 0 || r >= ROWS) return null;
    return { c, r };
  }

  hitTest(clientX, clientY, sim) {
    const point = this.fromClient(clientX, clientY);
    const cell = this.world.cell;
    let closestBag = null;
    let bagDistance = Infinity;
    for (const bag of sim.sandbags) {
      const box = this.cellRect(bag.c, bag.r);
      const distance = Math.hypot(point.x - (box.x + box.width / 2), point.y - (box.y + box.height / 2));
      if (distance < cell * 0.48 && distance < bagDistance) {
        closestBag = bag;
        bagDistance = distance;
      }
    }
    if (closestBag) return { type: "bag", bag: closestBag };

    for (const gate of sim.gates) {
      const box = this.cellRect(gate.c, gate.r);
      const distance = Math.hypot(point.x - (box.x + box.width / 2), point.y - (box.y + box.height / 2));
      if (distance < cell * 0.42) return { type: "gate", gate };
    }

    for (const building of BUILDINGS) {
      const box = this.cellRect(building.c, building.r);
      const width = building.w * cell;
      const height = building.h * cell;
      if (
        point.x >= box.x + 2 &&
        point.x <= box.x + width - 2 &&
        point.y >= box.y + 2 &&
        point.y <= box.y + height - 2
      ) {
        return { type: "building", building };
      }
    }

    const gridCell = this.cellFromClient(clientX, clientY);
    return gridCell ? { type: "cell", ...gridCell } : null;
  }

  draw(sim, visuals = {}) {
    const ctx = this.ctx;
    const { x, y, width, height, cell } = this.world;
    const time = visuals.time ?? performance.now() / 1000;
    ctx.clearRect(0, 0, this.width, this.height);

    const background = ctx.createRadialGradient(this.width * 0.5, this.height * 0.35, 10, this.width * 0.5, this.height * 0.5, this.width * 0.75);
    background.addColorStop(0, "#0b1c1d");
    background.addColorStop(1, "#061012");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    roundedRect(ctx, x - 1, y - 1, width + 2, height + 2, 3);
    ctx.clip();

    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        const box = this.cellRect(c, r);
        const elevation = sim.terrain[r][c];
        ctx.fillStyle = terrainColor(elevation);
        ctx.fillRect(box.x, box.y, box.width + 0.5, box.height + 0.5);
        if ((r + c) % 2 === 0) {
          ctx.fillStyle = "rgba(255,255,255,0.012)";
          ctx.fillRect(box.x, box.y, box.width, box.height);
        }
      }
    }

    this.drawRoads(sim, time);
    this.drawWater(sim, time);
    this.drawRiver(sim, time);
    this.drawDrainLinks(sim, time);
    this.drawBuildings(sim, visuals);
    this.drawSandbags(sim, visuals);
    this.drawGates(sim, time, visuals);
    this.drawFlowMarks(sim, time);
    this.drawRain(time, 0.15);
    this.drawMapFrame();

    if (visuals.dragCell) {
      const box = this.cellRect(visuals.dragCell.c, visuals.dragCell.r);
      ctx.strokeStyle = visuals.dragValid ? "rgba(139,224,195,0.9)" : "rgba(244,134,93,0.9)";
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      roundedRect(ctx, box.x + 2, box.y + 2, box.width - 4, box.height - 4, 3);
      ctx.stroke();
      ctx.setLineDash([]);
      if (visuals.dragValid) this.paintSandbag(box.x + box.width / 2, box.y + box.height / 2, cell, 0.72);
    }

  }

  drawRoads(sim, time) {
    const ctx = this.ctx;
    const { x, y, width, cell } = this.world;
    ctx.save();
    ctx.strokeStyle = "rgba(208,220,207,0.075)";
    ctx.lineWidth = cell * 0.52;
    for (const c of [3, 6, 9, 12]) {
      ctx.beginPath();
      ctx.moveTo(x + c * cell, y);
      ctx.lineTo(x + c * cell, y + ROWS * cell);
      ctx.stroke();
    }
    for (const r of [3, 6, 10]) {
      ctx.beginPath();
      ctx.moveTo(x, y + r * cell);
      ctx.lineTo(x + width, y + r * cell);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(230,236,218,0.1)";
    ctx.lineWidth = 0.7;
    ctx.setLineDash([cell * 0.15, cell * 0.16]);
    for (const c of [3.5, 6.5, 9.5, 12.5]) {
      ctx.beginPath();
      ctx.moveTo(x + c * cell, y);
      ctx.lineTo(x + c * cell, y + ROWS * cell);
      ctx.stroke();
    }
    for (const r of [3.5, 6.5, 10.5]) {
      ctx.beginPath();
      ctx.moveTo(x, y + r * cell);
      ctx.lineTo(x + width, y + r * cell);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(92,165,149,0.15)";
    ctx.lineWidth = 0.5;
    for (let c = 0; c <= COLS; c += 1) {
      ctx.beginPath();
      ctx.moveTo(x + c * cell, y);
      ctx.lineTo(x + c * cell, y + ROWS * cell);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r += 1) {
      ctx.beginPath();
      ctx.moveTo(x, y + r * cell);
      ctx.lineTo(x + width, y + r * cell);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawWater(sim, time) {
    const ctx = this.ctx;
    const { cell } = this.world;
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < LAND_COLS; c += 1) {
        const depth = sim.water[r][c];
        if (depth < 0.018) continue;
        const box = this.cellRect(c, r);
        const strength = Math.min(0.82, 0.1 + depth * 0.68);
        const alpha = strength * (0.72 + 0.05 * Math.sin(time * 1.4 + c * 2 + r));
        ctx.fillStyle = `rgba(47, 138, 148, ${alpha})`;
        ctx.fillRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
        if (depth > 0.14) {
          ctx.fillStyle = `rgba(111, 205, 201, ${Math.min(0.25, depth * 0.18)})`;
          ctx.fillRect(box.x + 2, box.y + box.height * 0.22, box.width - 4, 1);
        }
        if (depth > 0.55) {
          const pulse = (Math.sin(time * 2.2 + c * 1.7 + r) + 1) / 2;
          ctx.fillStyle = `rgba(190, 236, 218, ${0.1 + pulse * 0.09})`;
          ctx.fillRect(box.x + box.width * 0.2, box.y + box.height * 0.42, box.width * 0.35, 1);
        }
      }
    }

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = "rgba(35, 100, 108, 0.06)";
    ctx.fillRect(this.world.x, this.world.y + this.world.cell * 3.5, this.world.width, this.world.cell * 7);
    ctx.restore();
  }

  drawRiver(sim, time) {
    const ctx = this.ctx;
    const { x, y, width, height, cell } = this.world;
    const riverX = x + 15.2 * cell;
    const riverWidth = width - 15.2 * cell;
    const gradient = ctx.createLinearGradient(riverX, y, x + width, y);
    gradient.addColorStop(0, "#183e42");
    gradient.addColorStop(0.4, "#123236");
    gradient.addColorStop(1, "#092229");
    ctx.fillStyle = gradient;
    ctx.fillRect(riverX, y, riverWidth, height);

    ctx.fillStyle = "rgba(123, 193, 190, 0.15)";
    ctx.fillRect(riverX, y, 1.5, height);
    for (let i = 0; i < 22; i += 1) {
      const offset = ((i * 37 + time * (3.5 + (i % 4))) % (height + 18)) - 9;
      const waveX = riverX + 3 + ((i * 17 + time * 2) % Math.max(4, riverWidth - 6));
      ctx.strokeStyle = `rgba(124, 199, 196, ${0.07 + (i % 3) * 0.025})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(waveX - 4, y + offset);
      ctx.quadraticCurveTo(waveX, y + offset - 2.5, waveX + 5, y + offset);
      ctx.stroke();
    }

    const stageY = y + height * Math.max(0.08, Math.min(0.9, (4.15 - sim.riverStage) / 1.15));
    ctx.strokeStyle = "rgba(139, 224, 195, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(riverX, stageY);
    ctx.lineTo(x + width, stageY);
    ctx.stroke();

    ctx.save();
    ctx.translate(x + width - 10, y + height / 2 + 35);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "rgba(194, 224, 214, 0.32)";
    ctx.font = "8px 'Ubuntu Mono', monospace";
    ctx.letterSpacing = "0.12em";
    ctx.fillText("RIVER CHANNEL", -58, 0);
    ctx.restore();
  }

  drawDrainLinks(sim, time) {
    const ctx = this.ctx;
    const { cell } = this.world;
    for (const gate of sim.gates) {
      const start = this.cellRect(gate.c, gate.r);
      const endX = this.world.x + 15.2 * cell;
      const startX = start.x + start.width / 2;
      const startY = start.y + start.height / 2;
      const endY = startY;
      ctx.strokeStyle = gate.open ? "rgba(110, 210, 183, 0.34)" : "rgba(138, 159, 153, 0.16)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);
      if (gate.open) {
        const phase = (time * 0.8) % 1;
        ctx.fillStyle = `rgba(139,224,195,${0.22 * (1 - phase)})`;
        ctx.beginPath();
        ctx.arc(startX + (endX - startX) * phase, startY, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawBuildings(sim, visuals) {
    const ctx = this.ctx;
    const { cell } = this.world;
    const metrics = getMetrics(sim);
    BUILDINGS.forEach((building, index) => {
      const state = sim.buildings[index];
      const risk = !metrics.states[index].safe;
      const box = this.cellRect(building.c, building.r);
      const left = box.x + 2;
      const top = box.y + 2;
      const width = building.w * cell - 4;
      const height = building.h * cell - 4;
      const selected = visuals.selectedId === building.id;

      ctx.save();
      ctx.shadowColor = risk ? "rgba(227,94,67,0.22)" : "rgba(0,0,0,0.26)";
      ctx.shadowBlur = risk ? 8 : 5;
      ctx.shadowOffsetY = 2;
      let fill = risk ? "#4b3731" : "#243d3b";
      if (building.kind === "hospital") fill = risk ? "#4d3c2e" : "#294944";
      if (building.kind === "substation") fill = risk ? "#513924" : "#3e402c";
      const roofGradient = ctx.createLinearGradient(left, top, left, top + height);
      roofGradient.addColorStop(0, mixColor(fill, "#d2e2d8", 0.1));
      roofGradient.addColorStop(1, fill);
      ctx.fillStyle = roofGradient;
      roundedRect(ctx, left, top, width, height, 2.5);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = risk ? "rgba(244,134,93,0.8)" : "rgba(150,205,184,0.26)";
      ctx.lineWidth = selected ? 1.7 : 1;
      if (selected) {
        ctx.strokeStyle = "rgba(241,195,107,0.9)";
        ctx.shadowColor = "rgba(241,195,107,0.45)";
        ctx.shadowBlur = 7;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (building.kind === "residential") {
        ctx.strokeStyle = "rgba(219,231,219,0.09)";
        ctx.lineWidth = 0.7;
        const rows = building.floors;
        for (let i = 1; i < rows; i += 1) {
          const wy = top + (height / rows) * i;
          ctx.beginPath();
          ctx.moveTo(left + 4, wy);
          ctx.lineTo(left + width - 4, wy);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(160,210,190,0.17)";
        for (let rr = 0; rr < rows - 1; rr += 1) {
          for (let cc = 0; cc < 3; cc += 1) {
            const wx = left + 6 + cc * ((width - 12) / 3);
            const wy = top + 5 + rr * (height / rows);
            ctx.fillRect(wx, wy, Math.max(2, width / 12), 1.5);
          }
        }
      } else {
        ctx.fillStyle = risk ? "rgba(244,134,93,0.9)" : "rgba(139,224,195,0.88)";
        const cx = left + width / 2;
        const cy = top + height * 0.45;
        if (building.kind === "hospital") {
          ctx.fillRect(cx - 1.5, cy - 7, 3, 14);
          ctx.fillRect(cx - 7, cy - 1.5, 14, 3);
        } else {
          ctx.font = `${Math.max(11, cell * 0.42)}px 'Ubuntu', sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText("ϟ", cx, cy + cell * 0.16);
        }
      }

      ctx.fillStyle = "rgba(233,243,238,0.72)";
      ctx.font = `${Math.max(6.5, Math.min(9, cell * 0.2))}px 'Ubuntu Mono', monospace`;
      ctx.textAlign = "left";
      ctx.fillText(building.short, left + 4, top + Math.max(9, cell * 0.2));
      ctx.fillStyle = risk ? "rgba(255,170,132,0.92)" : "rgba(139,224,195,0.7)";
      ctx.textAlign = "right";
      ctx.fillText(`${state.level.toFixed(2)}`, left + width - 4, top + Math.max(9, cell * 0.2));
      ctx.restore();
    });
  }

  paintSandbag(cx, cy, cell, alpha = 1) {
    const ctx = this.ctx;
    const w = cell * 0.44;
    const h = cell * 0.19;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#9e8253";
    roundedRect(ctx, cx - w / 2, cy - h * 0.65, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = "#b89a69";
    roundedRect(ctx, cx - w / 2, cy + h * 0.05, w, h, h / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(240,214,161,0.55)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.28, cy - h * 0.25);
    ctx.lineTo(cx + w * 0.28, cy - h * 0.25);
    ctx.stroke();
    ctx.restore();
  }

  drawSandbags(sim, visuals) {
    const { cell } = this.world;
    for (const bag of sim.sandbags) {
      const box = this.cellRect(bag.c, bag.r);
      const dragging = visuals.draggingBagId === bag.id;
      this.paintSandbag(box.x + box.width / 2, box.y + box.height / 2, cell, dragging ? 0.28 : 1);
      if (visuals.hoverBagId === bag.id) {
        this.ctx.strokeStyle = "rgba(241,195,107,0.8)";
        this.ctx.lineWidth = 1.2;
        roundedRect(this.ctx, box.x + 2, box.y + 2, box.width - 4, box.height - 4, 3);
        this.ctx.stroke();
      }
    }
  }

  drawGates(sim, time, visuals) {
    const ctx = this.ctx;
    const { cell } = this.world;
    for (const gate of sim.gates) {
      const box = this.cellRect(gate.c, gate.r);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const radius = Math.max(7, cell * 0.27);
      const color = gate.open ? "139,224,195" : "241,195,107";
      ctx.save();
      ctx.shadowColor = `rgba(${color},0.4)`;
      ctx.shadowBlur = gate.open ? 9 : 4;
      ctx.fillStyle = `rgba(${color},0.12)`;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(${color},0.9)`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      const spokes = gate.open ? 4 : 3;
      for (let i = 0; i < spokes; i += 1) {
        const angle = (Math.PI * 2 * i) / spokes + (gate.open ? time * 0.45 : 0);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle) * radius * 0.72, cy + Math.sin(angle) * radius * 0.72);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(${color},0.92)`;
      ctx.font = "6.5px 'Ubuntu Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(gate.id.toUpperCase(), cx, cy + radius + 8);
      ctx.restore();
      if (visuals.hoverGateId === gate.id) {
        ctx.strokeStyle = "rgba(241,195,107,0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  drawFlowMarks(sim, time) {
    const ctx = this.ctx;
    const { cell } = this.world;
    ctx.fillStyle = "rgba(187,231,214,0.2)";
    for (let r = 1; r < ROWS - 1; r += 2) {
      for (let c = 1; c < LAND_COLS - 1; c += 2) {
        const flow = sim.flow[r][c];
        if (flow < 0.06) continue;
        const box = this.cellRect(c, r);
        const phase = Math.sin(time * 1.2 + c + r * 1.7);
        ctx.beginPath();
        ctx.moveTo(box.x + box.width * 0.58, box.y + box.height * 0.47);
        ctx.lineTo(box.x + box.width * 0.42, box.y + box.height * 0.47);
        ctx.lineTo(box.x + box.width * 0.49, box.y + box.height * 0.40 + phase * 1.4);
        ctx.strokeStyle = "rgba(187,231,214,0.2)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
  }

  drawRain(time, alpha = 0.2) {
    const ctx = this.ctx;
    const { x, y, width, height } = this.world;
    ctx.save();
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 72; i += 1) {
      const speed = 35 + (i % 5) * 12;
      const px = x + ((i * 173 + time * speed) % (width + 48)) - 24;
      const py = y + ((i * 89 + time * speed * 1.8) % (height + 24)) - 12;
      ctx.strokeStyle = `rgba(171,218,209,${alpha * (0.4 + (i % 4) * 0.14)})`;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - 4, py + 9);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawMapFrame() {
    const ctx = this.ctx;
    const { x, y, width, height, cell } = this.world;
    ctx.strokeStyle = "rgba(142,194,181,0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = "rgba(197,226,215,0.33)";
    ctx.font = "7px 'Ubuntu Mono', monospace";
    ctx.fillText("N", x + width - 13, y + 12);
    ctx.strokeStyle = "rgba(197,226,215,0.35)";
    ctx.beginPath();
    ctx.moveTo(x + width - 10, y + 16);
    ctx.lineTo(x + width - 10, y + 26);
    ctx.lineTo(x + width - 12, y + 22);
    ctx.moveTo(x + width - 10, y + 26);
    ctx.lineTo(x + width - 8, y + 22);
    ctx.stroke();
    ctx.fillStyle = "rgba(197,226,215,0.3)";
    ctx.fillRect(x + 12, y + height - 12, cell * 1.5, 1);
    ctx.fillRect(x + 12 + cell * 1.5, y + height - 15, 1, 4);
    ctx.font = "6.5px 'Ubuntu Mono', monospace";
    ctx.fillText("100 M", x + 13, y + height - 17);
  }
}

export class SectionRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.plot = {
      left: 38,
      right: 12,
      top: 28,
      groundBase: 0,
      landRight: 0,
      colScale: 1,
      waterScale: 1,
      riverWidth: 1,
    };
    this.buildingShapes = [];
    this.gateShapes = [];
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(300, rect.width);
    this.height = Math.max(280, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const left = this.width < 480 ? 30 : 39;
    const right = 11;
    const riverWidth = Math.max(31, Math.min(58, this.width * 0.085));
    const landRight = this.width - right - riverWidth;
    const colScale = (landRight - left) / 15.9;
    this.plot = {
      left,
      right,
      top: 26,
      groundBase: Math.max(142, this.height * 0.46),
      landRight,
      colScale,
      waterScale: Math.max(36, Math.min(68, this.height * 0.14)),
      riverWidth,
    };
  }

  fromClient(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * this.width,
      y: ((clientY - rect.top) / rect.height) * this.height,
    };
  }

  xForColumn(c) {
    return this.plot.left + (c + 0.25) * this.plot.colScale;
  }

  hitTest(clientX, clientY) {
    const point = this.fromClient(clientX, clientY);
    for (const shape of this.buildingShapes) {
      if (point.x >= shape.x && point.x <= shape.x + shape.width && point.y >= shape.top && point.y <= shape.bottom) {
        return { type: "building", id: shape.id };
      }
    }
    for (const shape of this.gateShapes) {
      if (Math.hypot(point.x - shape.x, point.y - shape.y) <= shape.radius + 4) {
        return { type: "gate", id: shape.id };
      }
    }
    return null;
  }

  groundElevation(view, column) {
    const source = view.columns[Math.max(0, Math.min(LAND_COLS - 1, column))];
    return source ? source.ground : 3.4;
  }

  groundY(elevation) {
    const amount = Math.max(0, Math.min(1, (elevation - 2.8) / 2));
    return this.plot.groundBase + (1 - amount) * Math.min(62, this.height * 0.15);
  }

  draw(sim, visuals = {}) {
    const { ctx, plot } = this;
    const time = visuals.time ?? performance.now() / 1000;
    const view = visuals.view;
    ctx.clearRect(0, 0, this.width, this.height);
    this.buildingShapes = [];
    this.gateShapes = [];

    const sky = ctx.createLinearGradient(0, 0, 0, plot.groundBase + 60);
    sky.addColorStop(0, "#0d2429");
    sky.addColorStop(0.45, "#102b2e");
    sky.addColorStop(1, "#173432");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.width, this.height);

    this.drawSky(time, sim);
    this.drawSoil(sim, view);
    this.drawStreetWater(sim, view, time);
    this.drawDrainShafts(sim, time);
    this.drawRiverSection(sim, time);
    this.drawBuildings(sim, view, visuals);
    this.drawRainInSection(time, sim.rainfall);
    this.drawScale();
    this.drawSectionFrame();
  }

  drawSky(time, sim) {
    const ctx = this.ctx;
    const { landRight, left, groundBase } = this.plot;
    ctx.save();
    for (let i = 0; i < 3; i += 1) {
      const cx = left + ((time * (9 + i * 4) + i * 230) % (landRight - left));
      const cy = 30 + i * 27 + Math.sin(time * 0.15 + i) * 5;
      const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 85);
      glow.addColorStop(0, `rgba(82,126,124,${0.08 + sim.rainfall * 0.05})`);
      glow.addColorStop(1, "rgba(82,126,124,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 110, 36 + i * 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(137,184,176,0.12)";
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 8; i += 1) {
      const y = 18 + i * 12;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(landRight, y + 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSoil(sim, view) {
    const ctx = this.ctx;
    const { left, landRight, groundBase, colScale } = this.plot;
    const points = [];
    for (let c = 0; c <= LAND_COLS; c += 1) {
      const elevation = this.groundElevation(view, Math.min(LAND_COLS - 1, c));
      points.push({ x: left + (c + 0.25) * colScale, y: this.groundY(elevation) });
    }
    const soil = ctx.createLinearGradient(0, groundBase - 20, 0, this.height);
    soil.addColorStop(0, "#25332b");
    soil.addColorStop(0.24, "#1a2927");
    soil.addColorStop(1, "#091616");
    ctx.fillStyle = soil;
    ctx.beginPath();
    ctx.moveTo(left, this.height);
    for (const point of points) ctx.lineTo(point.x, point.y);
    ctx.lineTo(landRight, this.height);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(199,219,196,0.28)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    ctx.strokeStyle = "rgba(165,188,164,0.08)";
    ctx.lineWidth = 0.7;
    for (let i = 1; i < 4; i += 1) {
      ctx.beginPath();
      for (let c = 0; c <= LAND_COLS; c += 1) {
        const point = points[Math.min(points.length - 1, c)];
        const y = point.y + 18 + i * 27;
        if (c === 0) ctx.moveTo(point.x, y);
        else ctx.lineTo(point.x, y + Math.sin(c * 0.8 + i) * 3);
      }
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(196,218,205,0.4)";
    ctx.font = "7px 'Ubuntu Mono', monospace";
    ctx.fillText("GROUND / URBAN STRATA", left + 5, groundBase + 72);
    ctx.restore();
  }

  drawStreetWater(sim, view, time) {
    const ctx = this.ctx;
    const { left, landRight, colScale, waterScale } = this.plot;
    const surfacePoints = [];
    const groundPoints = [];
    for (let c = 0; c < LAND_COLS; c += 1) {
      const groundY = this.groundY(this.groundElevation(view, c));
      const depth = view.columns[c]?.depth ?? sim.water[Math.floor(ROWS / 2)][c];
      const pulse = Math.sin(time * 1.3 + c * 0.8) * 0.6;
      surfacePoints.push({
        x: left + (c + 0.25) * colScale,
        y: groundY - Math.min(92, depth * waterScale) + pulse,
      });
      groundPoints.push({ x: left + (c + 0.25) * colScale, y: groundY });
    }
    const water = ctx.createLinearGradient(0, this.plot.groundBase - 70, 0, this.plot.groundBase + 25);
    water.addColorStop(0, "rgba(78, 174, 181, 0.78)");
    water.addColorStop(1, "rgba(30, 101, 111, 0.72)");
    ctx.fillStyle = water;
    ctx.beginPath();
    ctx.moveTo(surfacePoints[0].x, surfacePoints[0].y);
    for (const point of surfacePoints) ctx.lineTo(point.x, point.y);
    for (let i = groundPoints.length - 1; i >= 0; i -= 1) ctx.lineTo(groundPoints[i].x, groundPoints[i].y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(157,226,217,0.72)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    surfacePoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 7; i += 1) {
      const phase = ((time * 0.9 + i * 0.18) % 1);
      const index = Math.min(surfacePoints.length - 1, Math.floor(phase * (surfacePoints.length - 1)));
      const point = surfacePoints[index];
      const depth = view.columns[index]?.depth ?? 0;
      if (depth < 0.12) continue;
      ctx.fillStyle = "rgba(190,240,228,0.16)";
      ctx.fillRect(point.x - 9, point.y + 5 + (i % 3) * 4, 17, 1);
    }
    ctx.restore();

    for (const gate of sim.gates) {
      const x = this.xForColumn(gate.c);
      const groundY = this.groundY(this.groundElevation(view, gate.c));
      if (gate.open && view.gateBackflow > 0.001) {
        ctx.fillStyle = "rgba(244,134,93,0.2)";
        ctx.beginPath();
        ctx.arc(x, groundY + 4, 8 + Math.sin(time * 3) * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawDrainShafts(sim, time) {
    const ctx = this.ctx;
    const { landRight } = this.plot;
    for (const gate of sim.gates) {
      const x = this.xForColumn(gate.c);
      const actualGround = this.groundY(
        sim.terrain[Math.min(ROWS - 1, 9)][gate.c] * 0.38 +
          sim.terrain[Math.min(ROWS - 1, 6)][gate.c] * 0.62,
      );
      const y = actualGround - 4;
      const radius = 7;
      const color = gate.open ? "139,224,195" : "241,195,107";
      ctx.save();
      ctx.strokeStyle = `rgba(${color},0.7)`;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(x, y + radius);
      ctx.lineTo(x, y + radius + 16);
      ctx.stroke();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = gate.open ? "rgba(139,224,195,0.32)" : "rgba(178,190,174,0.14)";
      ctx.beginPath();
      ctx.moveTo(x, y + radius + 16);
      ctx.lineTo(landRight + 18, y + radius + 16);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(${color},0.14)`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(${color},0.9)`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      const spokes = gate.open ? 4 : 3;
      for (let i = 0; i < spokes; i += 1) {
        const angle = (i / spokes) * Math.PI * 2 + (gate.open ? time * 0.5 : 0);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * 4.7, y + Math.sin(angle) * 4.7);
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(${color},0.95)`;
      ctx.font = "6px 'Ubuntu Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${gate.id.toUpperCase()} ${gate.open ? "OPEN" : "SHUT"}`, x, y - radius - 5);
      ctx.restore();
      this.gateShapes.push({ id: gate.id, x, y, radius: radius + 5 });
    }
  }

  drawRiverSection(sim, time) {
    const ctx = this.ctx;
    const { landRight, right, riverWidth, groundBase } = this.plot;
    const x = landRight + 5;
    const width = riverWidth - 6;
    const bankTop = groundBase - 32;
    const riverTop = Math.max(62, bankTop + 12 - (sim.riverStage - 2.8) * 24);
    const river = ctx.createLinearGradient(x, riverTop, x + width, riverTop);
    river.addColorStop(0, "rgba(76,164,169,0.82)");
    river.addColorStop(1, "rgba(20,75,83,0.9)");
    ctx.fillStyle = "#0a1c20";
    ctx.fillRect(x - 2, bankTop, width + 4, this.height - bankTop);
    ctx.fillStyle = river;
    ctx.fillRect(x, riverTop, width, this.height - riverTop);

    ctx.strokeStyle = "rgba(139,224,195,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, riverTop);
    ctx.lineTo(x + width, riverTop + Math.sin(time * 1.1) * 0.8);
    ctx.stroke();
    for (let i = 0; i < 8; i += 1) {
      const y = riverTop + 12 + i * 18 + ((time * 4) % 14);
      if (y > this.height) continue;
      ctx.strokeStyle = "rgba(174,223,215,0.12)";
      ctx.beginPath();
      ctx.moveTo(x + 4 + (i % 3), y);
      ctx.quadraticCurveTo(x + width / 2, y - 2, x + width - 4, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(207,230,218,0.42)";
    ctx.font = "7px 'Ubuntu Mono', monospace";
    ctx.textAlign = "center";
    ctx.save();
    ctx.translate(x + width / 2, this.height - 17);
    ctx.fillText("RIVER", 0, 0);
    ctx.restore();
    ctx.strokeStyle = "rgba(184,215,202,0.25)";
    ctx.beginPath();
    ctx.moveTo(x - 2, bankTop);
    ctx.lineTo(x - 2, this.height);
    ctx.stroke();
    ctx.fillStyle = "rgba(241,195,107,0.65)";
    ctx.font = "6px 'Ubuntu Mono', monospace";
    ctx.fillText(`${sim.riverStage.toFixed(2)}M`, x + width / 2, Math.max(18, riverTop - 5));
  }

  drawBuildings(sim, view, visuals) {
    const ctx = this.ctx;
    const states = view.buildings;
    BUILDINGS.forEach((building, index) => {
      const state = states[index];
      const x = this.xForColumn(building.c);
      const width = building.w * this.plot.colScale - 5;
      const groundY = this.groundY(this.groundElevation(view, building.c + building.w / 2));
      const aboveHeight =
        building.kind === "hospital" ? 49 : building.kind === "substation" ? 41 : Math.min(42, 25 + building.floors * 2.2);
      const top = groundY - aboveHeight;
      const risk = !state.safe;
      const selected = visuals.selectedId === building.id;

      ctx.save();
      ctx.shadowColor = risk ? "rgba(237,105,74,0.28)" : "rgba(0,0,0,0.3)";
      ctx.shadowBlur = risk ? 10 : 6;
      const face = ctx.createLinearGradient(x, top, x + width, groundY);
      if (building.kind === "hospital") {
        face.addColorStop(0, risk ? "#6a4738" : "#345151");
        face.addColorStop(1, risk ? "#3d2e29" : "#203b3d");
      } else if (building.kind === "substation") {
        face.addColorStop(0, risk ? "#66472b" : "#4b4b31");
        face.addColorStop(1, risk ? "#372e26" : "#292f2a");
      } else {
        face.addColorStop(0, risk ? "#654237" : "#385250");
        face.addColorStop(1, risk ? "#3a2c28" : "#223839");
      }
      ctx.fillStyle = face;
      ctx.fillRect(x, top, width, aboveHeight);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = selected ? "rgba(241,195,107,0.95)" : risk ? "rgba(244,134,93,0.8)" : "rgba(145,200,184,0.38)";
      ctx.lineWidth = selected ? 1.8 : 1;
      ctx.strokeRect(x + 0.5, top + 0.5, width - 1, aboveHeight - 1);

      ctx.fillStyle = "rgba(5,16,18,0.38)";
      ctx.fillRect(x + 2, top + 2, width - 4, 4);
      ctx.strokeStyle = "rgba(220,234,220,0.1)";
      ctx.lineWidth = 0.7;
      const floorCount = building.kind === "residential" ? building.floors : building.kind === "hospital" ? 5 : 2;
      for (let floor = 1; floor < floorCount; floor += 1) {
        const floorY = top + (aboveHeight / floorCount) * floor;
        ctx.beginPath();
        ctx.moveTo(x + 3, floorY);
        ctx.lineTo(x + width - 3, floorY);
        ctx.stroke();
      }
      ctx.fillStyle = risk ? "rgba(244,134,93,0.32)" : "rgba(139,224,195,0.27)";
      const cols = Math.max(2, Math.floor(width / 8));
      for (let floor = 0; floor < floorCount; floor += 1) {
        for (let col = 0; col < cols; col += 1) {
          const wx = x + 4 + (col / cols) * (width - 8);
          const wy = top + 7 + (floor / floorCount) * (aboveHeight - 10);
          ctx.fillRect(wx, wy, Math.max(1, width / (cols * 2.8)), 1.7);
        }
      }

      if (building.kind !== "residential") {
        ctx.fillStyle = risk ? "rgba(244,134,93,0.85)" : "rgba(139,224,195,0.9)";
        ctx.font = `${Math.max(11, Math.min(17, width * 0.18))}px 'Ubuntu', sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(building.kind === "hospital" ? "+" : "ϟ", x + width / 2, top + aboveHeight * 0.52);
      }

      ctx.fillStyle = risk ? "rgba(255,179,139,0.96)" : "rgba(218,236,228,0.82)";
      ctx.font = `${Math.max(6, Math.min(8, this.plot.colScale * 0.16))}px 'Ubuntu Mono', monospace`;
      ctx.textAlign = "center";
      ctx.fillText(building.short, x + width / 2, top - 5);
      ctx.fillStyle = risk ? "rgba(255,164,120,0.88)" : "rgba(139,224,195,0.7)";
      ctx.font = "6.5px 'Ubuntu Mono', monospace";
      ctx.fillText(`${state.level.toFixed(2)}m`, x + width / 2, groundY - 4);

      const basementTop = groundY + 4;
      const basementHeight = Math.max(31, this.height * 0.105);
      const left = x + 3;
      const basementWidth = width - 6;
      ctx.fillStyle = "rgba(5,13,14,0.88)";
      ctx.fillRect(left, basementTop, basementWidth, basementHeight);
      ctx.strokeStyle = risk ? "rgba(244,134,93,0.38)" : "rgba(188,215,204,0.18)";
      ctx.lineWidth = 0.8;
      ctx.strokeRect(left + 0.5, basementTop + 0.5, basementWidth - 1, basementHeight - 1);
      const fillRatio = Math.max(0, Math.min(1, state.basement / 0.9));
      if (fillRatio > 0.01) {
        const fillHeight = basementHeight * fillRatio;
        const fill = ctx.createLinearGradient(left, basementTop + basementHeight - fillHeight, left, basementTop + basementHeight);
        fill.addColorStop(0, "rgba(239,124,82,0.65)");
        fill.addColorStop(1, "rgba(102,62,52,0.72)");
        ctx.fillStyle = fill;
        ctx.fillRect(left + 1, basementTop + basementHeight - fillHeight, basementWidth - 2, fillHeight);
        ctx.strokeStyle = "rgba(255,178,123,0.58)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(left + 1, basementTop + basementHeight - fillHeight);
        ctx.lineTo(left + basementWidth - 1, basementTop + basementHeight - fillHeight);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(215,227,218,0.46)";
      ctx.font = "6px 'Ubuntu Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(`B1 · ${state.basement.toFixed(2)}`, x + width / 2, basementTop + basementHeight + 9);
      ctx.restore();

      this.buildingShapes.push({
        id: building.id,
        x,
        width,
        top: top - 12,
        bottom: basementTop + basementHeight + 10,
      });
    });
  }

  drawRainInSection(time, rainfall) {
    const ctx = this.ctx;
    const { left, landRight, groundBase } = this.plot;
    ctx.save();
    for (let i = 0; i < 58; i += 1) {
      const px = left + ((i * 101 + time * (22 + (i % 4) * 8)) % (landRight - left));
      const py = 10 + ((i * 53 + time * (52 + (i % 5) * 7)) % Math.max(20, groundBase + 5));
      ctx.strokeStyle = `rgba(174,217,207,${0.035 + rainfall * 0.075 * (0.4 + (i % 4) * 0.14)})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - 3, py + 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawScale() {
    const ctx = this.ctx;
    const { left, groundBase } = this.plot;
    const x = left - 15;
    ctx.save();
    ctx.strokeStyle = "rgba(179,210,197,0.15)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, 110);
    ctx.lineTo(x, groundBase + 56);
    ctx.stroke();
    ctx.fillStyle = "rgba(179,210,197,0.28)";
    ctx.font = "6.5px 'Ubuntu Mono', monospace";
    ctx.textAlign = "right";
    for (let i = 0; i < 4; i += 1) {
      const y = 123 + i * 29;
      ctx.fillRect(x, y, 4, 0.7);
      ctx.fillText(`${(4.4 - i * 0.8).toFixed(1)}`, x - 3, y + 2);
    }
    ctx.save();
    ctx.translate(x - 28, 175);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "rgba(179,210,197,0.2)";
    ctx.fillText("ELEVATION / M", 0, 0);
    ctx.restore();
    ctx.restore();
  }

  drawSectionFrame() {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(139,190,177,0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(7.5, 7.5, this.width - 15, this.height - 15);
    ctx.fillStyle = "rgba(206,228,218,0.28)";
    ctx.font = "6.5px 'Ubuntu Mono', monospace";
    ctx.fillText("DEPTH VIEW", 13, this.height - 13);
    ctx.textAlign = "right";
    ctx.fillText("SCALE 1:400", this.width - 13, this.height - 13);
  }
}
