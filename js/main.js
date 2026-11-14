/* 主控：UI 绑定、游戏循环、HUD 更新，并暴露 window.__game 供自动化测试 */
(function () {
  "use strict";

  var sim = new PondSimulation();
  var renderer = new PondRenderer(document.getElementById("pond"));
  var audio = new PondAudio();

  var els = {
    clock: document.getElementById("clock"),
    banner: document.getElementById("status-banner"),
    aeration: document.getElementById("aeration"),
    pump: document.getElementById("pump"),
    shade: document.getElementById("shade"),
    aerationVal: document.getElementById("aeration-val"),
    pumpVal: document.getElementById("pump-val"),
    shadeVal: document.getElementById("shade-val"),
    btnStart: document.getElementById("btn-start"),
    btnPause: document.getElementById("btn-pause"),
    btnReset: document.getElementById("btn-reset"),
    btnSound: document.getElementById("btn-sound"),
    mAlgae: document.getElementById("m-algae"),
    mDo: document.getElementById("m-do"),
    mTurb: document.getElementById("m-turbidity"),
    mPlant: document.getElementById("m-plant"),
    mSed: document.getElementById("m-sediment"),
    tagAlgae: document.getElementById("tag-algae"),
    tagDo: document.getElementById("tag-do"),
    tagTurb: document.getElementById("tag-turb"),
    log: document.getElementById("log"),
    ctrlAer: document.getElementById("control-aeration"),
    ctrlShade: document.getElementById("control-shade")
  };

  var realInterval = null;
  var lastTick = 0;

  function readControls() {
    sim.setControls({
      aeration: Number(els.aeration.value),
      pump: Number(els.pump.value),
      shade: Number(els.shade.value)
    });
    els.aerationVal.textContent = els.aeration.value + "%";
    els.pumpVal.textContent = els.pump.value + "%";
    els.shadeVal.textContent = els.shade.value + "%";
  }

  ["aeration", "pump", "shade"].forEach(function (name) {
    els[name].addEventListener("input", readControls);
  });

  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  function setTag(el, ok, okText, badText) {
    el.textContent = ok ? okText : badText;
    el.className = "safe-tag " + (ok ? "ok" : "bad");
  }

  function renderLog() {
    var recent = sim.events.slice(-12).reverse();
    els.log.innerHTML = recent.map(function (e) {
      var t = fmtTime(PondSimulation.DURATION - e.tick);
      return '<li class="' + (e.level || "info") + '">[' + t + "] " + e.text + "</li>";
    }).join("");
  }

  function updateHud() {
    var snap = sim.snapshot();
    els.clock.textContent = fmtTime(snap.timeLeft);
    els.mAlgae.textContent = snap.algae.toFixed(1);
    els.mDo.textContent = snap.dissolvedOxygen.toFixed(2) + " mg/L";
    els.mTurb.textContent = snap.turbidity.toFixed(1) + " NTU";
    els.mPlant.textContent = snap.plantHealth.toFixed(1);
    els.mSed.textContent = snap.sedimentStability.toFixed(1);

    setTag(els.tagAlgae, snap.algae <= PondSimulation.ALGAE_SAFE, "安全", "超标");
    setTag(els.tagDo, snap.dissolvedOxygen >= PondSimulation.DO_SAFE, "安全", "偏低");
    els.tagTurb.textContent = snap.turbidity > 60 ? "浑浊" : snap.turbidity > 40 ? "偏高" : "清澈";
    els.tagTurb.className = snap.turbidity > 60 ? "safe-tag bad" : "safe-tag ok";

    els.ctrlAer.classList.toggle("alert", snap.controls.aeration > 70);
    els.ctrlShade.classList.toggle("alert", sim.shadeStressTicks > 30);

    if (snap.status === "won") {
      els.banner.textContent = "✔ 净化成功，水质达标！";
      els.banner.className = "banner win";
    } else if (snap.status === "lost") {
      els.banner.textContent = "✘ 治理失败：" + snap.loseReason;
      els.banner.className = "banner lose";
    } else if (snap.status === "paused") {
      els.banner.textContent = "已暂停";
      els.banner.className = "banner";
    } else if (snap.dissolvedOxygen < 3) {
      els.banner.textContent = "⚠ 溶氧告急，鱼群危险！";
      els.banner.className = "banner danger";
    } else if (snap.controls.aeration > 70) {
      els.banner.textContent = "⚠ 曝气过强，底泥正在被扰动！";
      els.banner.className = "banner danger";
    } else {
      els.banner.textContent = sim.status === "ready" ? "准备开始" : "治理进行中…";
      els.banner.className = sim.status === "ready" ? "banner" : "banner running";
    }
    renderLog();
  }

  function onTick() {
    var before = sim.events.length;
    var prevStatus = sim.status;
    sim.step();
    if (sim.events.length > before) {
      var last = sim.events[sim.events.length - 1];
      if (last.level === "danger") audio.blip(180, 0.2);
      else if (last.level === "warn") audio.blip(300, 0.12);
    }
    if (prevStatus === "running" && sim.status === "won") audio.win();
    if (prevStatus === "running" && sim.status === "lost") audio.lose();
    if (sim.status !== "running") stopLoop();
    updateHud();
  }

  function startLoop(intervalMs) {
    stopLoop();
    lastTick = performance.now();
    realInterval = setInterval(function () {
      onTick();
      audio.update(Number(els.aeration.value));
    }, intervalMs || 1000);
  }

  function stopLoop() {
    if (realInterval) {
      clearInterval(realInterval);
      realInterval = null;
    }
    audio.update(0);
  }

  els.btnStart.addEventListener("click", function () {
    audio.ensure();
    if (sim.status === "won" || sim.status === "lost") sim.reset();
    if (sim.status !== "running") {
      readControls();
      sim.status = "running";
      startLoop(1000);
      els.btnStart.disabled = true;
      els.btnPause.disabled = false;
      updateHud();
    }
  });

  els.btnPause.addEventListener("click", function () {
    if (sim.status === "running") {
      sim.status = "paused";
      stopLoop();
      els.btnPause.textContent = "继续";
    } else if (sim.status === "paused") {
      sim.status = "running";
      startLoop(1000);
      els.btnPause.textContent = "暂停";
    }
    updateHud();
  });
  els.btnPause.disabled = true;

  els.btnReset.addEventListener("click", function () {
    stopLoop();
    sim.reset();
    els.aeration.value = 0;
    els.pump.value = 0;
    els.shade.value = 0;
    els.btnStart.disabled = false;
    els.btnPause.disabled = true;
    els.btnPause.textContent = "暂停";
    readControls();
    updateHud();
  });

  els.btnSound.addEventListener("click", function () {
    audio.ensure();
    var on = audio.toggle();
    els.btnSound.textContent = "声音：" + (on ? "开" : "关");
  });

  // 渲染循环（与逻辑解耦，保证画面流畅）
  function renderFrame() {
    renderer.draw(sim.snapshot());
    requestAnimationFrame(renderFrame);
  }

  // —— 自动化测试钩子 ——
  window.__game = {
    sim: sim,
    audio: audio,
    setControls: function (c) {
      if (typeof c.aeration === "number") els.aeration.value = c.aeration;
      if (typeof c.pump === "number") els.pump.value = c.pump;
      if (typeof c.shade === "number") els.shade.value = c.shade;
      readControls();
      updateHud();
    },
    start: function () {
      sim.reset();
      sim.status = "running";
      updateHud();
    },
    tick: function (n) {
      for (var i = 0; i < (n || 1); i++) {
        if (sim.status !== "running") break;
        sim.step();
      }
      updateHud();
      return sim.snapshot();
    },
    reset: function () {
      stopLoop();
      sim.reset();
      updateHud();
      return sim.snapshot();
    },
    snapshot: function () { return sim.snapshot(); },
    render: function () { renderer.draw(sim.snapshot()); }
  };

  readControls();
  updateHud();
  renderFrame();
})();
