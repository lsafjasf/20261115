/* Canvas renderer: shaded dunes, contour lines, sand ripples, seed bands, ruts, wind, truck. */
(function (global) {
  const App = (global.App = global.App || {});

  function createRenderer(canvas, sim) {
    const ctx = canvas.getContext('2d');
    const W = sim.terrain.world.width;
    const H = sim.terrain.world.height;
    const cell = sim.cell;
    const gx = Math.ceil(W / cell);
    const gy = Math.ceil(H / cell);
    const terrainLayer = document.createElement('canvas');
    terrainLayer.width = W;
    terrainLayer.height = H;
    const tctx = terrainLayer.getContext('2d');
    const coverCanvas = document.createElement('canvas');
    coverCanvas.width = gx;
    coverCanvas.height = gy;
    const coverCtx = coverCanvas.getContext('2d');
    const coverImage = coverCtx.createImageData(gx, gy);
    const ruts = [];
    const windParticles = [];

    function rebuildTerrain() {
      drawShading();
      drawContours();
      drawRipples();
      drawZones();
    }

    function drawShading() {
      const img = tctx.createImageData(W, H);
      const d = img.data;
      const terrain = sim.terrain;
      let minH = Infinity;
      let maxH = -Infinity;
      const step = 6;
      for (let x = 0; x < W; x += step) {
        for (let y = 0; y < H; y += step) {
          const h = terrain.heightAt(x, y);
          minH = Math.min(minH, h);
          maxH = Math.max(maxH, h);
        }
      }
      for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
          const h = terrain.heightAt(x, y);
          const g = terrain.analyticGrad(x, y);
          const t = (h - minH) / (maxH - minH);
          const light = 0.82 - t * 0.28 + (-g.dx * 0.9 + g.dy * 0.5) * 0.35;
          const slope = Math.min(1, Math.hypot(g.dx, g.dy) / 0.4);
          const r = Math.max(0, Math.min(255, 214 * light - slope * 26));
          const gg = Math.max(0, Math.min(255, 184 * light - slope * 40));
          const b = Math.max(0, Math.min(255, 132 * light - slope * 44));
          const i = (y * W + x) * 4;
          d[i] = r;
          d[i + 1] = gg;
          d[i + 2] = b;
          d[i + 3] = 255;
        }
      }
      tctx.putImageData(img, 0, 0);
    }

    function drawContours() {
      const terrain = sim.terrain;
      const grid = 40;
      const cols = Math.ceil(W / grid);
      const rows = Math.ceil(H / grid);
      const heights = [];
      for (let i = 0; i <= cols; i++) {
        heights[i] = [];
        for (let j = 0; j <= rows; j++) heights[i][j] = terrain.heightAt(i * grid, j * grid);
      }
      let min = Infinity;
      let max = -Infinity;
      heights.flat().forEach((h) => {
        min = Math.min(min, h);
        max = Math.max(max, h);
      });
      tctx.strokeStyle = 'rgba(90,66,38,0.35)';
      tctx.lineWidth = 1;
      for (let level = Math.ceil(min / 4) * 4; level <= max; level += 4) {
        tctx.beginPath();
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            marchCell(tctx, i * grid, j * grid, grid, [
              heights[i][j],
              heights[i + 1][j],
              heights[i + 1][j + 1],
              heights[i][j + 1],
            ], level);
          }
        }
        tctx.stroke();
      }
    }

    function marchCell(c, x, y, size, hs, level) {
      const idx =
        (hs[0] > level ? 1 : 0) |
        (hs[1] > level ? 2 : 0) |
        (hs[2] > level ? 4 : 0) |
        (hs[3] > level ? 8 : 0);
      if (idx === 0 || idx === 15) return;
      const p = (a, b) => ((level - a) / (b - a)) * size;
      const top = [x + p(hs[0], hs[1]), y];
      const right = [x + size, y + p(hs[1], hs[2])];
      const bottom = [x + p(hs[3], hs[2]), y + size];
      const left = [x, y + p(hs[0], hs[3])];
      const seg = [
        null,
        [left, top],
        [top, right],
        [left, right],
        [right, bottom],
        [left, bottom],
        [top, bottom],
        [left, bottom],
      ];
      const s = seg[idx];
      if (s) {
        c.moveTo(s[0][0], s[0][1]);
        c.lineTo(s[1][0], s[1][1]);
      }
    }

    function drawRipples() {
      const rng = App.PRNG.mulberry32(sim.terrain.seed ^ 0x77aa);
      tctx.lineWidth = 1;
      for (let i = 0; i < 900; i++) {
        const x = rng() * W;
        const y = rng() * H;
        const len = 8 + rng() * 26;
        const ang = sim.terrain.contourAngle(x, y) + (rng() - 0.5) * 0.5;
        const alpha = 0.05 + rng() * 0.08;
        tctx.strokeStyle = 'rgba(120,90,52,' + alpha + ')';
        tctx.beginPath();
        tctx.moveTo(x, y);
        tctx.quadraticCurveTo(
          x + Math.cos(ang) * len * 0.5,
          y + Math.sin(ang) * len * 0.5 + (rng() - 0.5) * 4,
          x + Math.cos(ang) * len,
          y + Math.sin(ang) * len
        );
        tctx.stroke();
      }
    }

    function drawZones() {
      sim.zones.forEach((zone, zi) => {
        tctx.lineJoin = 'round';
        tctx.lineCap = 'round';
        tctx.lineWidth = zone.width;
        tctx.strokeStyle = 'rgba(70,120,200,0.28)';
        tctx.beginPath();
        zone.polyline.forEach((p, i) => {
          if (i === 0) tctx.moveTo(p.x, p.y);
          else tctx.lineTo(p.x, p.y);
        });
        tctx.stroke();
        tctx.lineWidth = 2;
        tctx.strokeStyle = 'rgba(40,80,170,0.7)';
        tctx.stroke();
        const start = zone.polyline[0];
        tctx.fillStyle = 'rgba(30,60,140,0.9)';
        tctx.font = 'bold 16px sans-serif';
        tctx.fillText('区域' + (zi + 1), start.x + 6, start.y - 14);
      });
    }

    function updateCoverageLayer() {
      const data = coverImage.data;
      for (let i = 0; i < sim.grid.covered.length; i++) {
        const on = sim.grid.covered[i] === 1;
        data[i * 4] = on ? 120 : 0;
        data[i * 4 + 1] = on ? 200 : 0;
        data[i * 4 + 2] = on ? 90 : 0;
        data[i * 4 + 3] = on ? 170 : 0;
      }
      coverCtx.putImageData(coverImage, 0, 0);
    }

    function pushRut() {
      const v = sim.vehicle;
      const cos = Math.cos(v.heading);
      const sin = Math.sin(v.heading);
      const nx = -sin * 7;
      const ny = cos * 7;
      ruts.push({ x1: v.x + nx, y1: v.y + ny, x2: v.x - nx, y2: v.y - ny });
      if (ruts.length > 1400) ruts.shift();
    }

    function drawRuts() {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(70,50,30,0.35)';
      ctx.beginPath();
      for (const r of ruts) {
        ctx.moveTo(r.x1, r.y1);
        ctx.lineTo(r.x2, r.y2);
      }
      ctx.stroke();
    }

    function updateWind(dt) {
      const rng = Math.random;
      while (windParticles.length < 70) {
        windParticles.push({ x: rng() * W, y: rng() * H, life: rng() });
      }
      for (const p of windParticles) {
        const wv = sim.wind.vectorAt(p.x, p.y, sim.time);
        p.x += wv.vx * dt * 6;
        p.y += wv.vy * dt * 6;
        p.life -= dt * 0.25;
        if (p.x < 0 || p.x > W || p.y < 0 || p.y > H || p.life <= 0) {
          p.x = rng() * W;
          p.y = rng() * H;
          p.life = 1;
        }
      }
    }

    function drawWind() {
      const ux = sim.wind.unit.x;
      const uy = sim.wind.unit.y;
      ctx.lineWidth = 1;
      for (const p of windParticles) {
        ctx.strokeStyle = 'rgba(255,250,235,' + (0.12 + p.life * 0.25) + ')';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - ux * 10, p.y - uy * 10);
        ctx.stroke();
      }
    }

    function drawTruck() {
      const v = sim.vehicle;
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.rotate(v.heading);
      ctx.fillStyle = v.sliding ? '#c0563b' : '#3c4f63';
      ctx.fillRect(-11, -7, 22, 14);
      ctx.fillStyle = '#d8b56b';
      ctx.fillRect(3, -5, 6, 10);
      ctx.fillStyle = '#222';
      ctx.fillRect(-9, -9, 5, 3);
      ctx.fillRect(-9, 6, 5, 3);
      ctx.fillRect(4, -9, 5, 3);
      ctx.fillRect(4, 6, 5, 3);
      if (v.sowing) {
        ctx.strokeStyle = 'rgba(120,200,90,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-12, -sim.width / 2);
        ctx.lineTo(-12, sim.width / 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawWindArrow() {
      const cx = 60;
      const cy = 60;
      const ux = sim.wind.unit.x;
      const uy = sim.wind.unit.y;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = 'rgba(40,40,40,0.7)';
      ctx.fillStyle = 'rgba(40,40,40,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-ux * 22, -uy * 22);
      ctx.lineTo(ux * 22, uy * 22);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ux * 26, uy * 26);
      ctx.lineTo(ux * 12 - uy * 6, uy * 12 + ux * 6);
      ctx.lineTo(ux * 12 + uy * 6, uy * 12 - ux * 6);
      ctx.closePath();
      ctx.fill();
      ctx.font = '13px sans-serif';
      ctx.fillText('风', -6, 40);
      ctx.restore();
    }

    function resetDynamic() {
      ruts.length = 0;
      updateCoverageLayer();
    }

    function render(dt) {
      updateWind(dt);
      pushRut();
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(terrainLayer, 0, 0);
      updateCoverageLayer();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(coverCanvas, 0, 0, W, H);
      drawRuts();
      drawWind();
      drawTruck();
      drawWindArrow();
    }

    rebuildTerrain();
    return { ctx, rebuildTerrain, render, resetDynamic, W, H };
  }

  App.Render = { createRenderer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
