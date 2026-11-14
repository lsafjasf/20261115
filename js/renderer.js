/* 渲染层：峡谷 / 钢索 / 观景台 / 悬挂餐车 / 温度色带 / 风力特效 */
(function () {
  'use strict';
  const C = window.CliffDining;

  const TEMP_HOT = 90, TEMP_WARM = 55;

  function tempColor(t) {
    const k = Math.max(0, Math.min(1, (t - TEMP_WARM) / (TEMP_HOT - TEMP_WARM)));
    const hue = k * 35;
    return 'hsl(' + hue + ', 90%, ' + (45 + k * 12) + '%)';
  }

  function carPoint(g) {
    const p = C.cablePoint(g.s);
    return {
      x: p.x + C.ROD_L * Math.sin(g.theta),
      y: p.y + C.ROD_L * Math.cos(g.theta),
      pivot: p,
    };
  }

  function drawBackground(ctx, g, w, h) {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#f7c98c');
    sky.addColorStop(0.45, '#e8936a');
    sky.addColorStop(1, '#8e4b57');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#fff2d8';
    ctx.beginPath();
    ctx.arc(w * 0.78, h * 0.16, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* 远处台地 */
    ctx.fillStyle = '#7c4a55';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.52);
    for (let x = 0; x <= w; x += 60) {
      ctx.lineTo(x, h * 0.52 + Math.sin(x * 0.013) * 26 + Math.cos(x * 0.031) * 12);
    }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();

    ctx.fillStyle = '#5e3742';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.62);
    for (let x = 0; x <= w; x += 44) {
      ctx.lineTo(x, h * 0.62 + Math.sin(x * 0.021 + 2) * 30);
    }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
  }

  function drawCanyon(ctx, w, h) {
    /* 两侧崖壁，中间为峡谷 */
    ctx.fillStyle = '#3d2230';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, h);
    for (let y = h; y >= 0; y -= 18) {
      ctx.lineTo(70 + Math.sin(y * 0.03) * 16 + Math.cos(y * 0.011) * 10, y);
    }
    ctx.closePath(); ctx.fill();

    ctx.beginPath();
    ctx.moveTo(w, 0);
    ctx.lineTo(w, h);
    for (let y = h; y >= 0; y -= 18) {
      ctx.lineTo(w - 70 + Math.sin(y * 0.027 + 4) * 16, y);
    }
    ctx.closePath(); ctx.fill();

    /* 谷底雾气 */
    const mist = ctx.createLinearGradient(0, h * 0.66, 0, h);
    mist.addColorStop(0, 'rgba(214,170,150,0)');
    mist.addColorStop(1, 'rgba(214,170,150,0.55)');
    ctx.fillStyle = mist;
    ctx.fillRect(0, h * 0.66, w, h * 0.34);

    /* 崖壁纹理 */
    ctx.strokeStyle = 'rgba(255,210,180,0.12)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const y = 60 + i * 58;
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.quadraticCurveTo(44, y + 10, 78, y + 4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w - 8, y + 26);
      ctx.quadraticCurveTo(w - 46, y + 34, w - 80, y + 30);
      ctx.stroke();
    }
  }

  function drawCable(ctx, g) {
    ctx.lineCap = 'round';
    /* 承重主索 */
    ctx.strokeStyle = 'rgba(40,28,34,0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const p = C.cablePoint(i / 120);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,225,190,0.5)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    /* 两端锚点 */
    for (const s of [0, 1]) {
      const p = C.cablePoint(s);
      ctx.fillStyle = '#2c1c26';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 下一观景台投递区高亮点 */
    if (g.nextDeck < C.DECKS.length) {
      const dp = C.cablePoint(C.DECKS[g.nextDeck].s);
      const pulse = 0.5 + 0.5 * Math.sin(g.t * 5);
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.4 * pulse;
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, 10 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawDecks(ctx, g) {
    C.DECKS.forEach((deck, i) => {
      const cp = C.cablePoint(deck.s);
      const top = 430;
      const dir = deck.side === 'left' ? -1 : 1;
      const x = cp.x + dir * 46;
      const delivered = i < g.nextDeck;
      const isNext = i === g.nextDeck;

      /* 支架 */
      ctx.strokeStyle = '#2a1820';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + dir * 18, 600);
      ctx.moveTo(x, top);
      ctx.lineTo(x - dir * 22, 600);
      ctx.stroke();

      /* 平台 */
      ctx.fillStyle = isNext ? '#7a5230' : '#4c3329';
      ctx.fillRect(x - 42, top - 8, 84, 10);
      ctx.fillStyle = '#34201c';
      for (let r = 0; r < 3; r++) ctx.fillRect(x - 38 + r * 27, top - 8, 3, 10);

      /* 栏杆 */
      ctx.strokeStyle = 'rgba(255,230,200,0.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 42, top - 8); ctx.lineTo(x - 42, top - 30);
      ctx.moveTo(x + 42, top - 8); ctx.lineTo(x + 42, top - 30);
      ctx.moveTo(x - 42, top - 30); ctx.lineTo(x + 42, top - 30);
      ctx.stroke();

      /* 状态灯与名牌 */
      ctx.fillStyle = delivered ? '#8ee08a' : isNext ? '#ffd166' : '#9a8278';
      ctx.beginPath();
      ctx.arc(x, top - 42, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(30,18,24,0.72)';
      ctx.fillRect(x - 46, top - 66, 92, 18);
      ctx.fillStyle = '#ffe9d2';
      ctx.font = 'NotoCJK, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(deck.name, x, top - 53);
    });
  }

  const gustParticles = [];

  function drawWind(ctx, g, w, h) {
    const strength = Math.abs(g.wind) / C.WIND_SCALE;
    if (Math.random() < strength * 0.9) {
      gustParticles.push({
        x: g.wind > 0 ? -10 : w + 10,
        y: 60 + Math.random() * 380,
        vx: g.wind * 0.9,
        life: 1.4 + Math.random(),
      });
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(255,240,220,0.55)';
    ctx.lineWidth = 1.6;
    for (let i = gustParticles.length - 1; i >= 0; i--) {
      const p = gustParticles[i];
      p.x += p.vx * 0.016;
      p.life -= 0.016;
      if (p.life <= 0 || p.x < -30 || p.x > w + 30) {
        gustParticles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.min(0.6, p.life * 0.5) * Math.min(1, strength + 0.2);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(p.x - p.vx * 0.04, p.y - 5, p.x - p.vx * 0.09, p.y - 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  const steamParticles = [];

  function drawDish(ctx, x, y, dish) {
    ctx.save();
    ctx.translate(x, y);
    /* 碗 */
    ctx.fillStyle = '#f3e6d4';
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d8c3a8';
    ctx.beginPath();
    ctx.ellipse(0, 1.5, 11, 4.5, 0, 0, Math.PI);
    ctx.fill();
    /* 汤汁：洒出比例越大液面越低 */
    const fillH = 3.2 * (1 - dish.spill);
    if (fillH > 0.2) {
      ctx.fillStyle = tempColor(dish.temp);
      ctx.beginPath();
      ctx.ellipse(0, -0.4, 9, Math.max(0.6, fillH), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    /* 温度色带 */
    ctx.fillStyle = tempColor(dish.temp);
    ctx.fillRect(-11, 7, 22, 3.4);
    ctx.strokeStyle = 'rgba(40,20,20,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-11, 7, 22, 3.4);
    ctx.fillStyle = '#3a2620';
    ctx.font = 'NotoCJK, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(dish.temp.toFixed(0) + '°', 0, 18);
    if (dish.done) {
      ctx.fillStyle = dish.good ? 'rgba(60,160,70,0.85)' : 'rgba(170,50,50,0.85)';
      ctx.beginPath();
      ctx.arc(0, -10, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'NotoCJK, sans-serif';
      ctx.fillText(dish.good ? '✓' : '×', 0, -7);
    }
    ctx.restore();
  }

  function drawCar(ctx, g) {
    const c = carPoint(g);
    /* 吊杆 */
    ctx.strokeStyle = '#241620';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(c.pivot.x, c.pivot.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
    /* 滑轮 */
    ctx.fillStyle = '#1d1118';
    ctx.beginPath();
    ctx.arc(c.pivot.x, c.pivot.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9a07a';
    ctx.beginPath();
    ctx.arc(c.pivot.x, c.pivot.y, 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(g.theta);
    /* 车厢 */
    const body = ctx.createLinearGradient(0, -10, 0, 34);
    body.addColorStop(0, '#b0563f');
    body.addColorStop(1, '#6e2f2c');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(-34, -6, 68, 40, 7);
    ctx.fill();
    ctx.strokeStyle = '#3c1f22';
    ctx.lineWidth = 2;
    ctx.stroke();
    /* 车窗与灯 */
    ctx.fillStyle = 'rgba(255,226,180,0.85)';
    ctx.fillRect(-26, 0, 18, 12);
    ctx.fillRect(8, 0, 18, 12);
    ctx.fillStyle = g.estopActive ? '#ff5a4e' : '#ffd98a';
    ctx.beginPath();
    ctx.arc(0, 28, 4, 0, Math.PI * 2);
    ctx.fill();
    /* 托盘与三道菜 */
    ctx.fillStyle = '#4a3327';
    ctx.fillRect(-40, -16, 80, 6);
    ctx.strokeStyle = '#2c1d17';
    ctx.strokeRect(-40, -16, 80, 6);
    g.dishes.forEach((d, i) => drawDish(ctx, -26 + i * 26, -18, d));
    ctx.restore();

    /* 热气（只对还热的未投递菜） */
    g.dishes.forEach((d, i) => {
      if (d.done || d.temp < 60) return;
      if (Math.random() < 0.25) {
        steamParticles.push({ x: c.x - 26 + i * 26, y: c.y - 26, life: 1 });
      }
    });
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = steamParticles.length - 1; i >= 0; i--) {
      const p = steamParticles[i];
      p.y -= 0.5; p.x += Math.sin(g.t * 4 + i) * 0.3; p.life -= 0.02;
      if (p.life <= 0) { steamParticles.splice(i, 1); continue; }
      ctx.globalAlpha = p.life * 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4 * p.life + 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHUD(ctx, g, w) {
    ctx.save();
    ctx.fillStyle = 'rgba(24,14,20,0.72)';
    ctx.beginPath();
    ctx.roundRect(14, 12, 300, 86, 10);
    ctx.fill();
    ctx.fillStyle = '#ffe9d2';
    ctx.font = 'NotoCJK, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('剩余投递: ' + (C.DECKS.length - g.nextDeck) + ' / 3   用时: ' + g.t.toFixed(1) + 's', 26, 34);
    g.dishes.forEach((d, i) => {
      const x = 26 + i * 94;
      ctx.fillStyle = tempColor(d.temp);
      ctx.fillRect(x, 46, 84, 9);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      const cold = Math.max(0, (C.TEMP_MIN - d.temp) / (C.TEMP_MIN - C.TEMP_AMBIENT));
      ctx.fillRect(x, 46, 84 * cold, 9);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.strokeRect(x, 46, 84, 9);
      ctx.fillStyle = '#ffe9d2';
      ctx.font = 'NotoCJK, sans-serif';
      const state = d.done ? (d.good ? '已送达✓' : '不合格×')
        : d.temp < C.TEMP_MIN ? '已凉' : Math.round(d.spill * 100) + '%洒';
      ctx.fillText('菜' + (i + 1) + ' ' + d.temp.toFixed(0) + '℃ ' + state, x, 69);
    });

    /* 风力指示 */
    const cx = w - 150, cy = 34;
    ctx.fillStyle = 'rgba(24,14,20,0.72)';
    ctx.beginPath();
    ctx.roundRect(w - 250, 12, 236, 56, 10);
    ctx.fill();
    ctx.fillStyle = '#ffe9d2';
    ctx.font = 'NotoCJK, sans-serif';
    ctx.fillText('风力', w - 238, 35);
    const mag = Math.min(1, Math.abs(g.wind) / C.WIND_SCALE);
    const dir = g.wind >= 0 ? 1 : -1;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 3;
    const ax = w - 180;
    ctx.beginPath();
    ctx.moveTo(ax, cy);
    ctx.lineTo(ax + dir * 90 * mag, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax + dir * 90 * mag, cy);
    ctx.lineTo(ax + dir * (90 * mag - 9), cy - 5);
    ctx.moveTo(ax + dir * 90 * mag, cy);
    ctx.lineTo(ax + dir * (90 * mag - 9), cy + 5);
    ctx.stroke();
    ctx.fillStyle = '#ffe9d2';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(g.wind) + ' N', w - 26, 56);
    ctx.restore();
  }

  function render(ctx, g) {
    const w = C.W, h = C.H;
    ctx.save();
    if (g.shake > 0) {
      ctx.translate((Math.random() - 0.5) * 7 * g.shake, (Math.random() - 0.5) * 7 * g.shake);
    }
    drawBackground(ctx, g, w, h);
    drawCanyon(ctx, w, h);
    drawDecks(ctx, g);
    drawCable(ctx, g);
    drawWind(ctx, g, w, h);
    drawCar(ctx, g);
    ctx.restore();
    drawHUD(ctx, g, w);

    if (g.messageT > 0 || g.status !== 'running') {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'NotoCJK, sans-serif';
      const tw = ctx.measureText(g.message).width + 44;
      ctx.fillStyle = 'rgba(24,14,20,0.8)';
      ctx.beginPath();
      ctx.roundRect(C.W / 2 - tw / 2, 104, tw, 38, 9);
      ctx.fill();
      ctx.fillStyle = g.status === 'lost' ? '#ff9a8e' : '#ffe9d2';
      ctx.fillText(g.message, C.W / 2, 129);
      ctx.restore();
    }
    if (g.status !== 'running') drawEndPanel(ctx, g);
  }

  function drawEndPanel(ctx, g) {
    const goods = g.dishes.filter((d) => d.good).length;
    ctx.fillStyle = 'rgba(20,12,18,0.78)';
    ctx.fillRect(0, 0, C.W, C.H);
    ctx.textAlign = 'center';
    ctx.fillStyle = g.status === 'won' ? '#9be08f' : '#ff8d80';
    ctx.font = 'NotoCJK, sans-serif';
    ctx.fillText(g.status === 'won' ? '送餐成功！' : '任务失败', C.W / 2, 230);
    ctx.fillStyle = '#ffe9d2';
    ctx.font = 'NotoCJK, sans-serif';
    ctx.fillText('三次投递完成，合格菜品 ' + goods + ' 盘（要求 ≥ 2 盘）', C.W / 2, 268);
    g.deliveries.forEach((r, i) => {
      ctx.fillStyle = r.good ? '#b7e8a8' : '#e8a8a0';
      ctx.fillText(
        r.deck + '：' + r.temp.toFixed(1) + '℃，洒出 ' + (r.spill * 100).toFixed(0) + '%，' +
        (r.good ? '合格' : '不合格'),
        C.W / 2, 304 + i * 26
      );
    });
    ctx.fillStyle = '#ffd166';
    ctx.font = 'NotoCJK, sans-serif';
    ctx.fillText('按 R 或点击“重新开始”再来一次', C.W / 2, 410);
  }

  window.RenderCliff = {
    tempColor, carPoint, render, drawHUD,
  };
})();
