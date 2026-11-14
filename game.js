/* 海上风电储能调度游戏：渲染 + 交互 + 声音 */
(function () {
  "use strict";
  var S = window.WindSim;
  var sea = document.getElementById("sea");
  var ctx = sea.getContext("2d");
  var state, speed = 1, muted = false, lastTs = 0, acc = 0;
  var hist = []; // {gen, dem} 功率历史
  var controls = { yaw: [0, 0, 0], pitch: [4, 4, 4], batteryMode: "auto", batteryKw: 6000 };
  var particles = [];

  function resize() {
    sea.width = sea.parentElement ? sea.clientWidth : window.innerWidth - 340;
    sea.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);

  // 世界坐标（米）：风机在 x=0，海岸在 x=+380，屏幕映射
  function toScreen(wx, wy) {
    var scale = Math.min(sea.width / 900, sea.height / 800);
    return { x: sea.width * 0.42 + wx * scale, y: sea.height * 0.5 + wy * scale, s: scale };
  }

  function reset() {
    state = S.createState((Math.random() * 1e9) | 0);
    hist = [];
    particles = [];
    for (var i = 0; i < 120; i++) {
      particles.push({ x: Math.random() * 900 - 450, y: Math.random() * 800 - 400 });
    }
    document.getElementById("banner").className = "";
    log("ok", "新一局开始：10 分钟内满足 3 次用电高峰，储能不低于 15%");
  }

  function log(cls, msg) {
    var el = document.getElementById("log");
    var d = document.createElement("div");
    d.className = cls;
    var t = state ? Math.floor(state.t) : 0;
    d.textContent = "[" + Math.floor(t / 60) + ":" + ("0" + (t % 60)).slice(-2) + "] " + msg;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
    while (el.children.length > 60) el.removeChild(el.firstChild);
  }

  // ---------- 渲染 ----------
  function drawSea() {
    var g = ctx.createLinearGradient(0, 0, sea.width, 0);
    g.addColorStop(0, "#0a2a44");
    g.addColorStop(0.75, "#0e3a5c");
    g.addColorStop(1, "#123c50");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, sea.width, sea.height);

    // 风粒子
    var dirRad = (state.wind.dir + 180) * Math.PI / 180; // 风吹向
    var vx = Math.cos(dirRad) * state.wind.speed * 0.9;
    var vy = Math.sin(dirRad) * state.wind.speed * 0.9;
    ctx.strokeStyle = "rgba(160,210,255,0.35)";
    ctx.lineWidth = 1;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.x += vx * 0.016 * 3; p.y += vy * 0.016 * 3;
      if (p.x > 460) p.x = -460; if (p.x < -460) p.x = 460;
      if (p.y > 410) p.y = -410; if (p.y < -410) p.y = 410;
      var s = toScreen(p.x, p.y);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - vx * 0.35 * s.s, s.y - vy * 0.35 * s.s);
      ctx.stroke();
    }

    // 海岸与储能站
    var shore = toScreen(380, 0);
    ctx.fillStyle = "#3a4a2f";
    ctx.fillRect(shore.x, 0, sea.width - shore.x, sea.height);
    ctx.fillStyle = "#54683f";
    ctx.fillRect(shore.x, 0, 8, sea.height);
    var bs = toScreen(430, 0);
    ctx.fillStyle = "#8a97a5";
    ctx.fillRect(bs.x - 26, bs.y - 34, 52, 68);
    ctx.fillStyle = state.battery.soc < S.BAT_MIN + 0.05 ? "#ff5f5f" : "#3fbf6f";
    var h = 60 * state.battery.soc;
    ctx.fillRect(bs.x - 22, bs.y + 30 - h, 44, h);
    ctx.fillStyle = "#0b1622";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("储能站", bs.x, bs.y + 50);

    // 输电线路（海上风机 -> 储能站），亮度随功率
    var totalGen = state.turbines.reduce(function (a, t) { return a + t.power; }, 0);
    var glow = Math.min(1, totalGen / 15000);
    ctx.strokeStyle = "rgba(255,215,111," + (0.25 + glow * 0.75) + ")";
    ctx.lineWidth = 1.5 + glow * 2;
    state.turbines.forEach(function (tb) {
      var a = toScreen(tb.x, tb.y);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bs.x - 26, bs.y); ctx.stroke();
    });
  }

  function drawTurbine(tb) {
    var s = toScreen(tb.x, tb.y);
    var R = 63 * s.s;
    // 尾流锥
    var dirRad = (state.wind.dir + 180) * Math.PI / 180;
    var wx = Math.cos(dirRad), wy = Math.sin(dirRad);
    var wakeLen = 300 * s.s;
    var grad = ctx.createLinearGradient(s.x, s.y, s.x + wx * wakeLen, s.y + wy * wakeLen);
    grad.addColorStop(0, "rgba(140,190,230,0.30)");
    grad.addColorStop(1, "rgba(140,190,230,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    var spread = 0.28;
    ctx.lineTo(s.x + wx * wakeLen - wy * wakeLen * spread, s.y + wy * wakeLen + wx * wakeLen * spread);
    ctx.lineTo(s.x + wx * wakeLen + wy * wakeLen * spread, s.y + wy * wakeLen - wx * wakeLen * spread);
    ctx.closePath(); ctx.fill();

    // 塔架 + 机舱
    ctx.fillStyle = "#c8d4de";
    ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, 7); ctx.fill();
    // 叶片（俯视：绕机舱旋转，转速随功率）
    var yawRad = (tb.yaw + 180) * Math.PI / 180;
    var rot = (state.t * tb.rpm / 60 * Math.PI * 2) % (Math.PI * 2);
    ctx.strokeStyle = tb.power > 0 ? "#e8f2fa" : "#7d93a8";
    ctx.lineWidth = 3;
    for (var b = 0; b < 3; b++) {
      var ang = yawRad + Math.cos(rot + b * Math.PI * 2 / 3) * 0.9;
      var len = R * (0.55 + 0.45 * Math.abs(Math.sin(rot + b * Math.PI * 2 / 3)));
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + Math.cos(ang) * len, s.y + Math.sin(ang) * len);
      ctx.stroke();
    }
    // 标签
    ctx.fillStyle = "#d7e3ee";
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.fillText("F" + (tb.id + 1) + " " + (tb.power / 1000).toFixed(1) + "MW", s.x, s.y - R - 8);
    ctx.fillStyle = "#8fb8d8";
    ctx.fillText(tb.windEff.toFixed(1) + "m/s", s.x, s.y + R + 16);
  }

  function drawWindArrow() {
    var cx = 70, cy = 70;
    ctx.fillStyle = "rgba(13,26,41,0.8)";
    ctx.beginPath(); ctx.arc(cx, cy, 46, 0, 7); ctx.fill();
    var a = (state.wind.dir + 180) * Math.PI / 180;
    ctx.strokeStyle = "#6fc3ff"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * 30, cy - Math.sin(a) * 30);
    ctx.lineTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 38, cy + Math.sin(a) * 38);
    ctx.lineTo(cx + Math.cos(a + 2.6) * 24, cy + Math.sin(a + 2.6) * 24);
    ctx.lineTo(cx + Math.cos(a - 2.6) * 24, cy + Math.sin(a - 2.6) * 24);
    ctx.closePath(); ctx.fillStyle = "#6fc3ff"; ctx.fill();
    ctx.fillStyle = "#d7e3ee"; ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.fillText(state.wind.speed.toFixed(1), cx, cy + 4);
  }

  // ---------- 面板 ----------
  var turbDivs = [];
  function buildPanel() {
    var box = document.getElementById("turbines");
    box.innerHTML = "";
    turbDivs = [];
    for (var i = 0; i < 3; i++) {
      (function (idx) {
        var d = document.createElement("div");
        d.className = "turbine-box";
        d.innerHTML =
          "<label>风机 F" + (idx + 1) + " 偏航 <span class='val' id='yawv" + idx + "'>0°</span></label>" +
          "<input type='range' min='-45' max='45' value='0' id='yaw" + idx + "'>" +
          "<label>桨距角 <span class='val' id='pitchv" + idx + "'>4°</span></label>" +
          "<input type='range' min='0' max='25' value='4' id='pitch" + idx + "'>";
        box.appendChild(d);
        document.getElementById("yaw" + idx).addEventListener("input", function (e) {
          controls.yaw[idx] = +e.target.value;
          document.getElementById("yawv" + idx).textContent = e.target.value + "°";
        });
        document.getElementById("pitch" + idx).addEventListener("input", function (e) {
          controls.pitch[idx] = +e.target.value;
          document.getElementById("pitchv" + idx).textContent = e.target.value + "°";
        });
        turbDivs.push(d);
      })(i);
    }
    document.querySelectorAll(".batmode").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".batmode").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        controls.batteryMode = b.dataset.m;
      });
    });
    document.querySelectorAll(".spd").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".spd").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        speed = +b.dataset.s;
      });
    });
    document.getElementById("restart").addEventListener("click", reset);
    document.getElementById("mute").addEventListener("click", function () {
      muted = !muted;
      this.textContent = muted ? "声音关" : "声音开";
    });
  }

  function fmtKw(kw) {
    return (kw / 1000).toFixed(1) + "MW";
  }

  function updatePanel() {
    var remain = Math.max(0, S.DURATION - state.t);
    document.getElementById("time").textContent =
      Math.floor(remain / 60) + ":" + ("0" + Math.floor(remain % 60)).slice(-2);
    document.getElementById("wind").textContent =
      state.wind.speed.toFixed(1) + " m/s / " + state.wind.dir.toFixed(0) + "°";
    var totalGen = state.turbines.reduce(function (a, t) { return a + t.power; }, 0);
    document.getElementById("power").textContent = fmtKw(totalGen) + " / " + fmtKw(state.demand);
    document.getElementById("soc").textContent = (state.battery.soc * 100).toFixed(1) + "%";
    document.getElementById("socbar").style.width = (state.battery.soc * 100) + "%";
    document.getElementById("socbar").style.background =
      state.battery.soc < S.BAT_MIN + 0.05 ? "#ff5f5f" : "#3fbf6f";
    document.getElementById("health").textContent = (state.battery.health * 100).toFixed(1) + "%";
    document.getElementById("healthbar").style.width = (state.battery.health * 100) + "%";
    var kw = state.battery.chargeKw;
    document.getElementById("batkw").textContent =
      (kw >= 0 ? "充 " : "放 ") + fmtKw(Math.abs(kw));
    document.getElementById("batbar").style.width = Math.min(100, Math.abs(kw) / 15000 * 100) + "%";
    document.getElementById("batbar").style.background =
      kw > S.BAT_MAX_CHARGE ? "#ff5f5f" : (kw >= 0 ? "#4da3ff" : "#bf8f3f");

    // 高峰指示
    var pk = document.getElementById("peaks");
    if (!pk.children.length) {
      S.PEAKS.forEach(function (p, i) {
        var d = document.createElement("div");
        d.className = "peak";
        d.textContent = "峰" + (i + 1) + " " + Math.floor(p.start / 60) + ":" + ("0" + p.start % 60).slice(-2);
        pk.appendChild(d);
      });
    }
    S.PEAKS.forEach(function (p, i) {
      var el = pk.children[i];
      if (state.t >= p.start && state.t < p.start + p.dur) el.className = "peak now";
      else if (state.t >= p.start + p.dur) {
        el.className = "peak " + (state.stats.peakUnmet[i] > state.stats.peakTotal[i] * 0.05 ? "miss" : "done");
      } else el.className = "peak";
    });
  }

  function drawChart() {
    var c = document.getElementById("chart");
    var g = c.getContext("2d");
    g.fillStyle = "#0d1a29"; g.fillRect(0, 0, c.width, c.height);
    var max = 16000;
    function plot(key, color) {
      g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath();
      for (var i = 0; i < hist.length; i++) {
        var x = i / 1200 * c.width;
        var y = c.height - (hist[i][key] / max) * c.height;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    plot("dem", "#ff6f6f");
    plot("gen", "#7dff9a");
    // 8MW 充电安全线
    g.strokeStyle = "rgba(255,95,95,0.4)";
    g.setLineDash([4, 4]);
    g.beginPath();
    var y8 = c.height - (8000 / max) * c.height;
    g.moveTo(0, y8); g.lineTo(c.width, y8); g.stroke();
    g.setLineDash([]);
  }

  // ---------- 主循环 ----------
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts;
    var dtReal = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    if (speed > 0 && !state.over) {
      acc += dtReal * speed;
      var evCount = state.events.length;
      while (acc >= S.DT && !state.over) {
        S.step(state, controls);
        acc -= S.DT;
      }
      for (var i = evCount; i < state.events.length; i++) {
        var e = state.events[i];
        log(e.type === "damage" ? "damage" : e.type, e.msg);
      }
      var totalGen = state.turbines.reduce(function (a, t) { return a + t.power; }, 0);
      hist.push({ gen: totalGen, dem: state.demand });
      if (hist.length > 1200) hist.shift();
      if (state.over) {
        var b = document.getElementById("banner");
        if (state.success) {
          b.className = "ok"; b.textContent = "✓ 调度成功！";
          log("ok", "★ 成功：三次高峰均满足，储能 " + (state.battery.soc * 100).toFixed(0) + "%");
        } else {
          b.className = "fail"; b.textContent = "✗ " + state.failReason;
          log("fail", "失败：" + state.failReason);
        }
      }
    }
    drawSea();
    state.turbines.forEach(drawTurbine);
    drawWindArrow();
    updatePanel();
    drawChart();
    updateAudio(totalGenNow());
  }

  function totalGenNow() {
    return state.turbines.reduce(function (a, t) { return a + t.power; }, 0);
  }

  // ---------- 声音：风声 + 机组嗡鸣随输出变化 + 警报 ----------
  var AC = null, windGain, windFilter, humOsc, humGain, alarmOsc, alarmGain;
  function initAudio() {
    if (AC) return;
    AC = new (window.AudioContext || window.webkitAudioContext)();
    // 风：循环噪声 -> 带通滤波
    var len = AC.sampleRate * 2;
    var buf = AC.createBuffer(1, len, AC.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = AC.createBufferSource();
    src.buffer = buf; src.loop = true;
    windFilter = AC.createBiquadFilter();
    windFilter.type = "bandpass"; windFilter.frequency.value = 400; windFilter.Q.value = 0.6;
    windGain = AC.createGain(); windGain.gain.value = 0;
    src.connect(windFilter); windFilter.connect(windGain); windGain.connect(AC.destination);
    src.start();
    // 机组嗡鸣
    humOsc = AC.createOscillator();
    humOsc.type = "sawtooth"; humOsc.frequency.value = 55;
    var humFilter = AC.createBiquadFilter();
    humFilter.type = "lowpass"; humFilter.frequency.value = 220;
    humGain = AC.createGain(); humGain.gain.value = 0;
    humOsc.connect(humFilter); humFilter.connect(humGain); humGain.connect(AC.destination);
    humOsc.start();
    // 警报
    alarmOsc = AC.createOscillator();
    alarmOsc.type = "square"; alarmOsc.frequency.value = 880;
    alarmGain = AC.createGain(); alarmGain.gain.value = 0;
    alarmOsc.connect(alarmGain); alarmGain.connect(AC.destination);
    alarmOsc.start();
  }

  var alarmPhase = 0;
  function updateAudio(genKw) {
    if (!AC) return;
    var t = AC.currentTime;
    if (muted || state.over) {
      windGain.gain.setTargetAtTime(0, t, 0.2);
      humGain.gain.setTargetAtTime(0, t, 0.2);
      alarmGain.gain.setTargetAtTime(0, t, 0.05);
      return;
    }
    var w = state.wind.speed / 24;
    windGain.gain.setTargetAtTime(0.03 + w * 0.12, t, 0.3);
    windFilter.frequency.setTargetAtTime(250 + state.wind.speed * 40, t, 0.3);
    var p = genKw / 15000;
    humGain.gain.setTargetAtTime(p * 0.10, t, 0.2);
    humOsc.frequency.setTargetAtTime(45 + p * 75, t, 0.2);
    // 过充或低储能时报警
    var danger = state.battery.chargeKw > S.BAT_MAX_CHARGE || state.battery.soc < S.BAT_MIN + 0.05;
    alarmPhase += 0.016;
    var beep = danger && (alarmPhase % 0.8) < 0.25;
    alarmGain.gain.setTargetAtTime(beep ? 0.05 : 0, t, 0.03);
  }

  // 首次交互解锁音频
  document.addEventListener("click", function unlock() {
    initAudio();
    if (AC && AC.state === "suspended") AC.resume();
    document.removeEventListener("click", unlock);
  });

  // ---------- 启动 ----------
  resize();
  buildPanel();
  reset();
  requestAnimationFrame(frame);
})();
