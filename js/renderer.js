/* Canvas renderer: ice grid, stress cracks, rolling sphere, detection rings. */
(function (global) {
  const { T } = global.IceWorld;
  const { C } = global.IceSim;

  function create(canvas, world) {
    const ctx = canvas.getContext('2d');
    canvas.width = world.width;
    canvas.height = world.height;

    function drawCellBg(cell, x, y, stress) {
      const px = x * world.cell, py = y * world.cell;
      if (cell === T.HOLE) {
        ctx.fillStyle = '#0b1c2c';
        ctx.fillRect(px, py, world.cell, world.cell);
        ctx.fillStyle = 'rgba(80,140,190,0.18)';
        ctx.beginPath();
        ctx.arc(px + world.cell / 2, py + world.cell / 2, world.cell * 0.32, 0, 7);
        ctx.fill();
        return;
      }
      if (cell === T.CAMP) {
        ctx.fillStyle = '#16324a';
        ctx.fillRect(px, py, world.cell, world.cell);
      } else if (cell === T.THIN) {
        /* Thin ice bends: darker, more blue-grey as stress rises. */
        const s = stress || 0;
        const g = Math.round(150 - s * 60);
        ctx.fillStyle = `rgb(${g - 30}, ${g + 8}, ${g + 28})`;
        ctx.fillRect(px, py, world.cell, world.cell);
        if (s > 0) {
          ctx.fillStyle = `rgba(20,40,60,${0.12 + s * 0.35})`;
          ctx.beginPath();
          ctx.ellipse(px + world.cell / 2, py + world.cell / 2,
            world.cell * (0.2 + s * 0.3), world.cell * (0.16 + s * 0.26),
            0, 0, 7);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = '#cfe6f5';
        ctx.fillRect(px, py, world.cell, world.cell);
      }
    }

    function drawGrid() {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= world.cols; x++) {
        ctx.beginPath();
        ctx.moveTo(x * world.cell, 0);
        ctx.lineTo(x * world.cell, world.height);
        ctx.stroke();
      }
      for (let y = 0; y <= world.rows; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * world.cell);
        ctx.lineTo(world.width, y * world.cell);
        ctx.stroke();
      }
    }

    function drawCracks() {
      for (const [k, lines] of world.cracks) {
        const s = world.stress[k] || 0;
        if (s < C.stressCrack * 0.6) continue;
        ctx.strokeStyle = `rgba(20,30,45,${0.35 + s * 0.5})`;
        ctx.lineWidth = 1 + s * 1.6;
        for (const pts of lines) {
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.stroke();
        }
      }
    }

    function drawPoints(sim) {
      for (const p of world.points) {
        const cx = (p.x + 0.5) * world.cell;
        const cy = (p.y + 0.5) * world.cell;
        const active = sim.activePoint === p.id;
        ctx.beginPath();
        ctx.arc(cx, cy, world.cell * 0.5, 0, 7);
        ctx.strokeStyle = p.measured
          ? 'rgba(80,220,140,0.9)'
          : active ? 'rgba(255,210,90,0.95)' : 'rgba(255,140,90,0.8)';
        ctx.lineWidth = active ? 3 : 2;
        ctx.setLineDash(active ? [] : [6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        if (active) {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, world.cell * 0.5, -Math.PI / 2,
            -Math.PI / 2 + (sim.measureProgress / C.measureTime) * Math.PI * 2);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255,210,90,0.25)';
          ctx.fill();
        }
        ctx.fillStyle = p.measured ? '#3ddc84' : '#ff8c5a';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(p.measured ? '✓' : ('P' + (p.id + 1)), cx, cy + 4);
      }
    }

    function drawCamp() {
      const cx = (world.camp.x + 0.5) * world.cell;
      const cy = (world.camp.y + 0.5) * world.cell;
      ctx.strokeStyle = 'rgba(120,200,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, C.campRadius, 0, 7);
      ctx.stroke();
      ctx.fillStyle = '#9fd8ff';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('CAMP', cx, cy - C.campRadius - 4);
    }

    function drawSphere(sim) {
      ctx.save();
      ctx.translate(sim.x, sim.y);
      ctx.rotate(sim.roll);
      ctx.beginPath();
      ctx.arc(0, 0, C.radius, 0, 7);
      const grad = ctx.createRadialGradient(-4, -4, 2, 0, 0, C.radius);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#7fb4dd');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = '#2c5d85';
      ctx.lineWidth = 2;
      ctx.stroke();
      /* Rolling marker so rotation is visible. */
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(C.radius - 2, 0);
      ctx.strokeStyle = '#1d3f5c';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      if (sim.lastThrust && sim.time - sim.lastThrust.t < 0.18) {
        const a = sim.lastThrust;
        ctx.strokeStyle = 'rgba(255,230,150,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sim.x - a.dx * 10, sim.y - a.dy * 10);
        ctx.lineTo(sim.x - a.dx * 24, sim.y - a.dy * 24);
        ctx.stroke();
      }
    }

    function render(sim) {
      ctx.clearRect(0, 0, world.width, world.height);
      for (let y = 0; y < world.rows; y++) {
        for (let x = 0; x < world.cols; x++) {
          const k = y * world.cols + x;
          drawCellBg(world.types[k], x, y, world.stress[k]);
        }
      }
      drawGrid();
      drawCracks();
      drawCamp();
      drawPoints(sim);
      drawSphere(sim);
    }

    return { render, ctx };
  }

  globalThis.IceRenderer = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.IceRenderer;
})(globalThis);
