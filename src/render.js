/* Canvas 分栏渲染：左机械（液压），右电路，顶部共享状态灯 */
(function (root) {
  'use strict';

  var COL = {
    bg: '#10151c', panel: '#182029', edge: '#2b3a4a',
    ok: '#3ddc84', warn: '#ffb300', bad: '#ff5252',
    text: '#cfd8dc', dim: '#78909c', pipe: '#37474f', oil: '#4fc3f7'
  };

  function light(ctx, x, y, r, on, color, label) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = on ? color : '#26313b';
    ctx.fill();
    if (on) {
      ctx.shadowColor = color; ctx.shadowBlur = 12;
      ctx.fill(); ctx.shadowBlur = 0;
    }
    ctx.fillStyle = COL.dim;
    ctx.font = '11px "Noto Sans CJK SC","Microsoft YaHei",monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + r + 13);
  }

  function gauge(ctx, x, y, r, value, max, safeLo, safeHi, label, unit) {
    var a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#26313b';
    ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.stroke();
    // 安全区
    ctx.strokeStyle = 'rgba(61,220,132,0.45)';
    ctx.beginPath();
    ctx.arc(x, y, r, a0 + (a1 - a0) * safeLo / max, a0 + (a1 - a0) * safeHi / max);
    ctx.stroke();
    // 指针
    var frac = Math.max(0, Math.min(1, value / max));
    var ang = a0 + (a1 - a0) * frac;
    var inSafe = value >= safeLo && value <= safeHi;
    ctx.strokeStyle = inSafe ? COL.ok : COL.bad;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * (r - 6), y + Math.sin(ang) * (r - 6));
    ctx.stroke();
    ctx.fillStyle = COL.text;
    ctx.font = 'bold 15px "Noto Sans CJK SC","Microsoft YaHei",monospace';
    ctx.textAlign = 'center';
    ctx.fillText(value.toFixed(1), x, y + r * 0.55);
    ctx.fillStyle = COL.dim;
    ctx.font = '11px "Noto Sans CJK SC","Microsoft YaHei",monospace';
    ctx.fillText(label + ' (' + unit + ')', x, y + r * 0.55 + 15);
  }

  function drawMechanical(ctx, st, cfg, x0, y0, w, h, t) {
    ctx.fillStyle = COL.panel;
    ctx.strokeStyle = COL.edge;
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeRect(x0, y0, w, h);
    ctx.fillStyle = COL.text;
    ctx.font = 'bold 14px "Noto Sans CJK SC","Microsoft YaHei",monospace';
    ctx.textAlign = 'left';
    ctx.fillText('机械 / 液压（玩家A）', x0 + 12, y0 + 22);

    // 压力表
    gauge(ctx, x0 + 90, y0 + 100, 58, st.pressure, 12,
      cfg.pressureMin, cfg.pressureMax, '压力', 'bar');

    // 泵：旋转叶轮
    var px = x0 + 90, py = y0 + 250;
    ctx.strokeStyle = COL.edge;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(px, py, 42, 0, Math.PI * 2); ctx.stroke();
    var ang = (t * st.pumpSpeed * 6) % (Math.PI * 2);
    ctx.strokeStyle = st.pumpSpeed > 0.05 ? COL.oil : COL.dim;
    ctx.lineWidth = 5;
    for (var i = 0; i < 3; i++) {
      var a = ang + i * Math.PI * 2 / 3;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * 34, py + Math.sin(a) * 34);
      ctx.stroke();
    }
    ctx.fillStyle = COL.dim;
    ctx.font = '11px "Noto Sans CJK SC","Microsoft YaHei",monospace';
    ctx.textAlign = 'center';
    ctx.fillText('液压泵 [Q] ' + (st.cmd.pump ? '指令ON' : '指令OFF'), px, py + 62);
    ctx.fillText('转速 ' + Math.round(st.pumpSpeed * 100) + '%', px, py + 77);

    // 主管 + 三支路闸门
    var mainY = py;
    ctx.strokeStyle = COL.pipe;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(px + 42, mainY);
    ctx.lineTo(x0 + w - 40, mainY);
    ctx.stroke();
    for (var g = 0; g < 3; g++) {
      var gx = x0 + 220 + g * 100;
      var topY = y0 + 90;
      ctx.beginPath();
      ctx.moveTo(gx, mainY);
      ctx.lineTo(gx, topY + 30);
      ctx.stroke();
      // 闸阀：开口随开度
      var open = st.gatePos[g];
      var gap = 4 + open * 26;
      ctx.fillStyle = st.cmd.gates[g] ? COL.oil : '#546e7a';
      ctx.fillRect(gx - 16, mainY - 30 - gap, 32, 14); // 上阀瓣
      ctx.fillRect(gx - 16, mainY - 16 + gap, 32, 14); // 下阀瓣
      // 油流
      if (open > 0.1) {
        ctx.fillStyle = 'rgba(79,195,247,0.8)';
        var fy = topY + 30 + ((t * 120 * open + g * 40) % (mainY - topY - 30));
        ctx.fillRect(gx - 3, fy, 6, 14);
      }
      ctx.fillStyle = COL.dim;
      ctx.font = '11px "Noto Sans CJK SC","Microsoft YaHei",monospace';
      ctx.textAlign = 'center';
      var key = ['A', 'S', 'D'][g];
      ctx.fillText('闸' + (g + 1) + ' [' + key + '] ' + Math.round(open * 100) + '%', gx, topY + 16);
      if (st.gateDelay[g] > 0) {
        ctx.fillStyle = COL.warn;
        ctx.fillText('液压延迟…', gx, mainY + 32);
      }
    }
  }

  function drawElectrical(ctx, st, cfg, x0, y0, w, h) {
    ctx.fillStyle = COL.panel;
    ctx.strokeStyle = COL.edge;
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeRect(x0, y0, w, h);
    ctx.fillStyle = COL.text;
    ctx.font = 'bold 14px "Noto Sans CJK SC","Microsoft YaHei",monospace';
    ctx.textAlign = 'left';
    ctx.fillText('电路（玩家B）', x0 + 12, y0 + 22);

    // 电压表
    gauge(ctx, x0 + 130, y0 + 100, 58, st.voltage, 300,
      cfg.voltMin, cfg.voltMax, '电压', 'V');

    // 母线
    var busX = x0 + 60, busY0 = y0 + 205, busY1 = y0 + h - 30;
    ctx.strokeStyle = st.cmd.breaker ? COL.warn : '#546e7a';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(busX, busY0); ctx.lineTo(busX, busY1); ctx.stroke();

    // 断路器
    ctx.strokeStyle = COL.edge;
    ctx.fillStyle = '#212c38';
    ctx.fillRect(busX - 24, busY0 - 40, 48, 34);
    ctx.strokeRect(busX - 24, busY0 - 40, 48, 34);
    ctx.strokeStyle = st.cmd.breaker ? COL.ok : COL.bad;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(busX - 14, busY0 - 23);
    ctx.lineTo(busX + 14, st.cmd.breaker ? busY0 - 23 : busY0 - 36);
    ctx.stroke();
    ctx.fillStyle = COL.dim;
    ctx.font = '11px "Noto Sans CJK SC","Microsoft YaHei",monospace';
    ctx.textAlign = 'center';
    ctx.fillText('断路器 [P]', busX, busY0 - 48);

    // 三继电器
    for (var r = 0; r < 3; r++) {
      var ry = busY0 + 35 + r * 78;
      var rx = busX + 150;
      ctx.strokeStyle = '#3a4a5a';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(busX, ry); ctx.lineTo(rx - 40, ry); ctx.stroke();
      ctx.fillStyle = '#212c38';
      ctx.fillRect(rx - 40, ry - 24, 90, 48);
      ctx.strokeRect(rx - 40, ry - 24, 90, 48);
      // 触点
      ctx.strokeStyle = st.cmd.relays[r] ? COL.ok : COL.dim;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(rx - 28, ry);
      ctx.lineTo(rx - 4, st.cmd.relays[r] ? ry : ry - 14);
      ctx.stroke();
      // 线圈 LED
      ctx.beginPath();
      ctx.arc(rx + 32, ry, 6, 0, Math.PI * 2);
      ctx.fillStyle = st.cmd.relays[r] ? COL.ok : '#26313b';
      ctx.fill();
      ctx.fillStyle = COL.dim;
      ctx.font = '11px "Noto Sans CJK SC","Microsoft YaHei",monospace';
      ctx.textAlign = 'center';
      ctx.fillText('继电器' + (r + 1) + ' [' + ['J', 'K', 'L'][r] + ']', rx + 5, ry + 38);
      // 通往设备组
      ctx.strokeStyle = st.cmd.relays[r] ? 'rgba(61,220,132,0.6)' : '#3a4a5a';
      ctx.beginPath(); ctx.moveTo(rx + 50, ry); ctx.lineTo(x0 + w - 60, ry); ctx.stroke();
      ctx.fillStyle = st.groups[r].restored ? COL.ok : COL.dim;
      ctx.fillText('设备组' + (r + 1), x0 + w - 40, ry + 4);
    }
  }

  function draw(ctx, st, cfg, t, logLines) {
    var W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);

    // 顶部共享状态灯
    ctx.fillStyle = COL.text;
    ctx.font = 'bold 15px "Noto Sans CJK SC","Microsoft YaHei",monospace';
    ctx.textAlign = 'left';
    ctx.fillText('地下设施联合检修 —— 共享状态灯', 20, 26);
    var lx = 60;
    light(ctx, lx, 52, 9, st.voltageOk, COL.ok, '电源');
    light(ctx, lx + 80, 52, 9, st.pressureOk, st.pressureZone === 'critical' ? COL.bad : COL.ok, '压力');
    light(ctx, lx + 160, 52, 9, st.pumpSpeed > 0.5, COL.oil, '泵运行');
    for (var i = 0; i < 3; i++) {
      light(ctx, lx + 250 + i * 70, 52, 9, st.groups[i].restored, COL.ok, '组' + (i + 1));
    }
    // 保持计时
    ctx.textAlign = 'right';
    ctx.fillStyle = st.allRestored ? COL.ok : COL.dim;
    ctx.font = 'bold 14px "Noto Sans CJK SC","Microsoft YaHei",monospace';
    var holdTxt = st.allRestored
      ? '安全保持 ' + st.hold.toFixed(0) + ' / ' + cfg.holdTime + 's'
      : '恢复全部三组后开始计时';
    ctx.fillText(holdTxt, W - 20, 56);
    if (st.allRestored) {
      ctx.fillStyle = '#26313b';
      ctx.fillRect(W - 320, 64, 300, 8);
      ctx.fillStyle = COL.ok;
      ctx.fillRect(W - 320, 64, 300 * Math.min(1, st.hold / cfg.holdTime), 8);
    }

    drawMechanical(ctx, st, cfg, 16, 90, 520, 440, t);
    drawElectrical(ctx, st, cfg, W - 536, 90, 520, 440);

    // 底部日志与提示
    ctx.textAlign = 'left';
    ctx.font = '12px "Noto Sans CJK SC","Microsoft YaHei",monospace';
    for (var l = 0; l < logLines.length; l++) {
      ctx.fillStyle = l === logLines.length - 1 ? COL.text : COL.dim;
      ctx.fillText(logLines[l], 20, 552 + l * 17);
    }
    ctx.fillStyle = COL.dim;
    ctx.fillText('玩家A(液压): Q=泵 A/S/D=闸门1/2/3      玩家B(电路): P=断路器 J/K/L=继电器1/2/3      Enter=开始/重开',
      20, H - 14);

    if (st.status !== 'running') {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.font = 'bold 40px "Noto Sans CJK SC","Microsoft YaHei",monospace';
      ctx.fillStyle = st.status === 'won' ? COL.ok : COL.bad;
      ctx.fillText(st.status === 'won' ? '检修成功' : '检修失败', W / 2, H / 2 - 20);
      ctx.font = '16px "Noto Sans CJK SC","Microsoft YaHei",monospace';
      ctx.fillStyle = COL.text;
      var reason = st.status === 'won'
        ? '三组设备恢复，压力电压安全保持 ' + cfg.holdTime + ' 秒'
        : (st.failReason === 'overpressure' ? '过压爆管：泵启动时泄压通路不足' : st.failReason);
      ctx.fillText(reason, W / 2, H / 2 + 14);
      ctx.fillText('按 Enter 重新开始', W / 2, H / 2 + 44);
    }
  }

  root.Render = { draw: draw };
})(typeof self !== 'undefined' ? self : this);
