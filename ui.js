// 海边温室 UI：Canvas 渲染 + Web Audio 合成 + 交互控制
/* global GreenhouseSim */
(function () {
  const Sim = GreenhouseSim;
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const GROUND = 480, GH_L = 150, GH_R = 880, WALL_TOP = 200, RIDGE_Y = 110;
  const zoneX = i => 180 + i * 223;          // 各区左边界
  const zoneCX = i => zoneX(i) + 111;        // 各区中心

  let S = Sim.createState();
  let running = false;
  let speed = 8;                              // 模拟秒 / 真实秒
  let fanAngle = 0;
  let lastLogLen = 0;

  // ---------------- Web Audio ----------------
  const AudioSys = {
    ctx: null, fanGain: null, fanFilter: null, alarmTimer: 0,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      // 风机：循环噪声 -> 低通滤波 -> 增益
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      this.fanFilter = this.ctx.createBiquadFilter();
      this.fanFilter.type = 'lowpass'; this.fanFilter.frequency.value = 400;
      this.fanGain = this.ctx.createGain(); this.fanGain.gain.value = 0;
      src.connect(this.fanFilter).connect(this.fanGain).connect(this.ctx.destination);
      src.start();
    },
    // 每帧根据模拟状态更新
    update(dt) {
      if (!this.ctx) return;
      const p = Sim.fanPower(S);
      const t = this.ctx.currentTime;
      this.fanGain.gain.setTargetAtTime(0.12 * p, t, 0.1);
      this.fanFilter.frequency.setTargetAtTime(300 + 700 * p, t, 0.1);
      // 报警：病害 / 锈蚀过重 / 盐雾饱和 / 设备停转
      const alarm = S.disease.some(x => x > 0) || S.stopped.fan ||
        S.corrosion.fan > 80 || Sim.avgFog(S) > 1.0;
      this.alarmTimer -= dt;
      if (alarm && this.alarmTimer <= 0 && !S.over) {
        this.alarmTimer = 0.55;
        this.beep(880, 0.16, 'square', 0.06);
        setTimeout(() => this.beep(660, 0.16, 'square', 0.06), 200);
      }
      // 滴灌声
      for (let i = 0; i < 3; i++) {
        if (S.valve[i].open && !S.maint.active && Math.random() < dt * 1.5) {
          this.beep(1400 + Math.random() * 600, 0.05, 'sine', 0.03);
        }
      }
    },
    beep(freq, dur, type, vol) {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.value = freq;
      const t = this.ctx.currentTime;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t); o.stop(t + dur);
    },
  };

  // ---------------- 盐雾粒子 ----------------
  const fogPuffs = [];
  function spawnFog() {
    for (let i = 0; i < 3; i++) {
      const want = Math.floor(S.fog[i] * 26);
      const have = fogPuffs.filter(p => p.zone === i).length;
      for (let k = have; k < want; k++) {
        fogPuffs.push({
          zone: i,
          x: zoneX(i) + Math.random() * 223,
          y: 150 + Math.random() * 300,
          r: 14 + Math.random() * 22,
          vx: 4 + Math.random() * 8,
          ph: Math.random() * 6.28,
        });
      }
    }
    for (let i = fogPuffs.length - 1; i >= 0; i--) {
      const p = fogPuffs[i];
      const want = Math.floor(S.fog[p.zone] * 26);
      if (fogPuffs.filter(q => q.zone === p.zone).length > want + 4) fogPuffs.splice(i, 1);
    }
  }

  // ---------------- HUD ----------------
  const $ = id => document.getElementById(id);
  function bar(label, pct, cls) {
    return '<div class="row"><span class="lbl">' + label + '</span>' +
      '<div class="bar ' + cls + '"><i style="transform:scaleX(' + (pct / 100).toFixed(2) + ')"></i></div>' +
      '<span class="val">' + Math.round(pct) + '%</span></div>';
  }
  function updateHUD() {
    const mm = t => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');
    $('clock').textContent = mm(S.t) + ' / 20:00';
    $('temp').textContent = S.temp.toFixed(1) + ' ℃';
    $('rustBars').innerHTML =
      bar('除雾风机', S.corrosion.fan, 'rust') +
      bar('遮阳帘', S.corrosion.curtain, 'rust') +
      bar('滴灌阀·叶菜', S.corrosion.valve[0], 'rust') +
      bar('滴灌阀·育苗', S.corrosion.valve[1], 'rust') +
      bar('滴灌阀·果菜', S.corrosion.valve[2], 'rust');
    let zb = '';
    for (let i = 0; i < 3; i++) {
      zb += bar(Sim.TARGETS[i].name + '湿度', S.humidity[i], '') +
            bar(Sim.TARGETS[i].name + '健康', S.health[i], 'hp');
    }
    $('zoneBars').innerHTML = zb;
    // 按钮状态
    $('btnFan').textContent = '除雾风机：' + (S.fan.on ? '开' : '关');
    $('btnFan').classList.toggle('on', S.fan.on);
    $('btnFanSpd').textContent = '档位 ' + S.fan.speed;
    $('btnCurtain').textContent = '遮阳帘：' + (S.curtain.closed ? '关（展开）' : '开（收起）');
    $('btnCurtain').classList.toggle('on', S.curtain.closed);
    document.querySelectorAll('.btnValve').forEach(b => {
      const i = +b.dataset.i;
      b.classList.toggle('on', S.valve[i].open);
    });
    $('btnMaint').disabled = S.maint.active || S.over;
    $('btnMaint').textContent = S.maint.active
      ? '🔧 检修中…'
      : '🔧 安排检修（已完成 ' + S.maint.done + ' 次）';
    // 日志
    if (S.events.length !== lastLogLen) {
      lastLogLen = S.events.length;
      $('log').innerHTML = S.events.map(e =>
        '<div>[' + mm(e.t) + '] ' + e.msg + '</div>').join('');
      $('log').scrollTop = 1e6;
    }
  }

  // ---------------- 主循环 ----------------
  let lastTs = 0;
  function frame(ts) {
    const dtReal = Math.min(0.1, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    if (running && !S.over) {
      let simDt = dtReal * speed;
      while (simDt > 0) { Sim.step(S, 0.5); simDt -= 0.5; }
      spawnFog();
    }
    const now = ts;
    drawFrame(now); drawGreenhouse(); drawZones(now); drawFog(now); drawEquipment(now);
    AudioSys.update(dtReal);
    updateHUD();
    if (S.over && running) { running = false; showBanner(); }
    requestAnimationFrame(frame);
  }

  function showBanner() {
    const b = $('banner');
    b.classList.add('show');
    b.querySelector('.big').textContent = S.win ? '🎉 通过！' : '💀 失败';
    b.querySelector('.sub').textContent = S.win
      ? '作物全部存活，并完成 ' + S.maint.done + ' 次检修'
      : '原因：' + S.failReason;
  }

  function reset() {
    S = Sim.createState();
    fogPuffs.length = 0;
    lastLogLen = 0;
    $('banner').classList.remove('show');
  }

  // ---------------- 交互 ----------------
  $('start').onclick = () => {
    AudioSys.init();
    if (AudioSys.ctx.state === 'suspended') AudioSys.ctx.resume();
    running = !running;
    $('start').textContent = running ? '⏸ 暂停' : '▶ 继续模拟';
  };
  $('again').onclick = () => { reset(); running = true; $('start').textContent = '⏸ 暂停'; };
  $('speed').onclick = () => {
    speed = speed === 8 ? 20 : speed === 20 ? 2 : 8;
    $('speed').textContent = '速度 ×' + speed;
  };
  $('btnFan').onclick = () => { S.fan.on = !S.fan.on; };
  $('btnFanSpd').onclick = () => { S.fan.speed = S.fan.speed === 1 ? 2 : 1; };
  $('btnCurtain').onclick = () => { S.curtain.closed = !S.curtain.closed; };
  document.querySelectorAll('.btnValve').forEach(b => {
    b.onclick = () => { const i = +b.dataset.i; S.valve[i].open = !S.valve[i].open; };
  });
  // ---------------- 渲染 ----------------
  function rustColor(c) { // 锈蚀程度 -> 铁锈色叠加
    return 'rgba(150,72,30,' + (c / 100 * 0.85).toFixed(2) + ')';
  }

  function drawFrame(now) {
    // 天空与太阳
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#274b6d'); sky.addColorStop(0.7, '#7fa8c4'); sky.addColorStop(1, '#c8d8c9');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    const sunH = Sim.sunAt(S.t);
    ctx.fillStyle = 'rgba(255,236,170,' + (0.35 + sunH * 0.65) + ')';
    ctx.beginPath(); ctx.arc(700, 60 + (1 - sunH) * 60, 30, 0, 7); ctx.fill();
    // 海
    ctx.fillStyle = '#2e6f8e';
    ctx.fillRect(0, 330, GH_L, H - 330);
    ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2;
    for (let r = 0; r < 4; r++) {
      ctx.beginPath();
      for (let x = 0; x <= GH_L; x += 6) {
        const y = 345 + r * 32 + Math.sin(x / 18 + now / 400 + r * 2) * 4;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#dbe7ee'; ctx.font = '13px sans-serif';
    ctx.fillText('海（盐雾源）', 20, 325);
    // 地面
    ctx.fillStyle = '#8a7a5a'; ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = '#6f6248'; ctx.fillRect(0, GROUND, W, 6);
  }

  function drawGreenhouse() {
    // 金属骨架（锈蚀随平均腐蚀加深）
    const avgRust = (S.corrosion.fan + S.corrosion.curtain +
      S.corrosion.valve[0] + S.corrosion.valve[1] + S.corrosion.valve[2]) / 5;
    ctx.strokeStyle = '#9aa8b2'; ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(GH_L, GROUND); ctx.lineTo(GH_L, WALL_TOP);
    ctx.lineTo((GH_L + GH_R) / 2, RIDGE_Y); ctx.lineTo(GH_R, WALL_TOP); ctx.lineTo(GH_R, GROUND);
    ctx.stroke();
    ctx.strokeStyle = rustColor(avgRust); ctx.lineWidth = 5; ctx.stroke();
    // 玻璃
    ctx.fillStyle = 'rgba(180,220,240,0.10)';
    ctx.beginPath();
    ctx.moveTo(GH_L, GROUND); ctx.lineTo(GH_L, WALL_TOP);
    ctx.lineTo((GH_L + GH_R) / 2, RIDGE_Y); ctx.lineTo(GH_R, WALL_TOP); ctx.lineTo(GH_R, GROUND);
    ctx.closePath(); ctx.fill();
    // 立柱
    ctx.lineWidth = 3;
    for (let i = 0; i <= 3; i++) {
      const x = zoneX(i) - (i === 0 ? 0 : 0);
      ctx.strokeStyle = '#8b98a2';
      ctx.beginPath(); ctx.moveTo(x, GROUND); ctx.lineTo(x, 190); ctx.stroke();
      ctx.strokeStyle = rustColor(avgRust);
      ctx.beginPath(); ctx.moveTo(x, GROUND); ctx.lineTo(x, 190); ctx.stroke();
    }
  }

  function drawZones(now) {
    for (let i = 0; i < 3; i++) {
      const x = zoneX(i), w = 223;
      // 湿度可视化：蓝色雾罩
      const humA = Math.max(0, (S.humidity[i] - 30) / 70) * 0.35;
      ctx.fillStyle = 'rgba(70,140,220,' + humA.toFixed(2) + ')';
      ctx.fillRect(x + 4, 200, w - 8, GROUND - 200);
      // 病害警示色
      if (S.disease[i] > 0) {
        ctx.fillStyle = 'rgba(160,60,200,' + (S.disease[i] / 100 * 0.25).toFixed(2) + ')';
        ctx.fillRect(x + 4, 200, w - 8, GROUND - 200);
      }
      // 苗床
      ctx.fillStyle = '#5d4a33';
      ctx.fillRect(x + 14, GROUND - 46, w - 28, 46);
      ctx.fillStyle = '#3e5b2f';
      ctx.fillRect(x + 14, GROUND - 52, w - 28, 8);
      // 作物：颜色随健康退化
      const hp = S.health[i] / 100;
      const g = Math.floor(80 + 120 * hp), r = Math.floor(180 - 100 * hp);
      for (let p = 0; p < 6; p++) {
        const px = x + 34 + p * 32;
        const sway = Math.sin(now / 600 + p) * 2;
        ctx.strokeStyle = 'rgb(' + r + ',' + g + ',60)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(px, GROUND - 52);
        ctx.quadraticCurveTo(px + sway, GROUND - 75, px + sway * 2, GROUND - 92);
        ctx.stroke();
        ctx.fillStyle = 'rgb(' + r + ',' + g + ',70)';
        ctx.beginPath(); ctx.ellipse(px + sway * 2 - 6, GROUND - 84, 7, 4, -0.5, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.ellipse(px + sway * 2 + 6, GROUND - 88, 7, 4, 0.5, 0, 7); ctx.fill();
        if (S.disease[i] > 20) { // 病斑
          ctx.fillStyle = 'rgba(90,40,120,.8)';
          ctx.beginPath(); ctx.arc(px + sway * 2 + 3, GROUND - 86, 2.5, 0, 7); ctx.fill();
        }
      }
      // 区名与湿度
      ctx.fillStyle = '#eaf4fb'; ctx.font = '13px sans-serif';
      ctx.fillText(Sim.TARGETS[i].name + '  湿度 ' + S.humidity[i].toFixed(0) + '%' +
        '（目标 ' + Sim.TARGETS[i].lo + '-' + Sim.TARGETS[i].hi + '）', x + 16, 222);
    }
  }

  function drawFog(now) {
    for (const p of fogPuffs) {
      p.x += p.vx * 0.016; p.ph += 0.01;
      if (p.x > zoneX(p.zone) + 223) p.x = zoneX(p.zone);
      const a = 0.10 + 0.06 * Math.sin(p.ph);
      ctx.fillStyle = 'rgba(210,215,220,' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    }
  }

  function drawEquipment(now) {
    // 除雾风机（右墙）
    const fx = GH_R - 26, fy = 250, fr = 30;
    const fp = Sim.fanPower(S);
    fanAngle += fp * 0.25;
    ctx.fillStyle = '#39434c';
    ctx.beginPath(); ctx.arc(fx, fy, fr + 6, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(fx, fy); ctx.rotate(fanAngle);
    ctx.fillStyle = S.stopped.fan ? '#5a3a28' : '#c7d3da';
    for (let b = 0; b < 3; b++) {
      ctx.rotate(Math.PI * 2 / 3);
      ctx.beginPath(); ctx.ellipse(0, -fr * 0.55, 7, fr * 0.55, 0.3, 0, 7); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = rustColor(S.corrosion.fan);
    ctx.beginPath(); ctx.arc(fx, fy, fr + 6, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif';
    ctx.fillText(S.stopped.fan ? '风机停转!' : '风机 ' + Math.round(fp * 50) + '%', fx - 30, fy + fr + 20);
    // 遮阳帘（屋脊展开）
    const curtEff = S.curtain.closed && !S.maint.active ? Sim.eff(S.corrosion.curtain) : 0;
    const cl = curtEff * 300;
    ctx.fillStyle = 'rgba(60,60,70,0.85)';
    ctx.beginPath();
    ctx.moveTo((GH_L + GH_R) / 2, RIDGE_Y + 4);
    ctx.lineTo((GH_L + GH_R) / 2 - cl, WALL_TOP + 4 - cl * 0.28);
    ctx.lineTo((GH_L + GH_R) / 2 - cl, WALL_TOP + 22 - cl * 0.28);
    ctx.lineTo((GH_L + GH_R) / 2, RIDGE_Y + 22);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo((GH_L + GH_R) / 2, RIDGE_Y + 4);
    ctx.lineTo((GH_L + GH_R) / 2 + cl, WALL_TOP + 4 - cl * 0.28);
    ctx.lineTo((GH_L + GH_R) / 2 + cl, WALL_TOP + 22 - cl * 0.28);
    ctx.lineTo((GH_L + GH_R) / 2, RIDGE_Y + 22);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = rustColor(S.corrosion.curtain);
    ctx.fillRect((GH_L + GH_R) / 2 - cl, RIDGE_Y + 2, cl * 2, 8);
    // 滴灌管与阀
    for (let i = 0; i < 3; i++) {
      const x = zoneX(i), open = S.valve[i].open && !S.maint.active;
      const ve = Sim.eff(S.corrosion.valve[i]);
      ctx.strokeStyle = '#7c8894'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x + 16, GROUND - 60); ctx.lineTo(x + 207, GROUND - 60); ctx.stroke();
      ctx.fillStyle = open ? '#3f9c66' : '#8a4a3a';
      ctx.fillRect(x + 20, GROUND - 74, 16, 16);
      ctx.fillStyle = rustColor(S.corrosion.valve[i]);
      ctx.fillRect(x + 20, GROUND - 74, 16, 16);
      if (open && ve > 0.02) { // 水滴
        ctx.fillStyle = 'rgba(90,160,255,.8)';
        for (let dnum = 0; dnum < 5; dnum++) {
          const dx = x + 50 + dnum * 34;
          const dy = GROUND - 58 + ((now / 14 + dnum * 37) % 26) * ve;
          ctx.beginPath(); ctx.arc(dx, dy, 2.2, 0, 7); ctx.fill();
        }
      }
    }
    // 检修进度
    if (S.maint.active) {
      ctx.fillStyle = 'rgba(10,16,24,.55)'; ctx.fillRect(GH_L, 130, GH_R - GH_L, 40);
      ctx.fillStyle = '#ffd27d'; ctx.font = '16px sans-serif';
      ctx.fillText('🔧 检修中… 剩余 ' + Math.ceil(S.maint.remaining) + 's（设备停机）', GH_L + 24, 156);
      ctx.fillStyle = '#0c141d'; ctx.fillRect(GH_L + 320, 142, 300, 14);
      ctx.fillStyle = '#ffb347';
      ctx.fillRect(GH_L + 320, 142, 300 * (1 - S.maint.remaining / Sim.MAINT_TIME), 14);
    }
  }

  // ---------------- 交互 ----------------
  $('btnMaint').onclick = () => Sim.startMaintenance(S);
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'f') $('btnFan').click();
    else if (k === 'c') $('btnCurtain').click();
    else if (k === 'm') $('btnMaint').click();
    else if (k >= '1' && k <= '3') {
      const i = +k - 1; S.valve[i].open = !S.valve[i].open;
    }
  });

  requestAnimationFrame(frame);
})();
