(function () {
  "use strict";

  const DATA = window.TestShipData;
  const Planner = window.TestShipPlanner;
  const audio = new window.ShipAudio();
  const canvas = document.getElementById("shipCanvas");
  const renderer = new window.ShipRenderer(canvas);

  const ICONS = {
    inspect:
      '<svg viewBox="0 0 16 16"><circle cx="6.7" cy="6.7" r="3.4"/><path d="M9.2 9.2 14 14"/><path d="M5 6.8h3.4"/></svg>',
    sample:
      '<svg viewBox="0 0 16 16"><path d="M5 2h6"/><path d="M5.5 2v3l-2 6.4c-.3 1 .5 2.1 1.6 2.1h5.8c1.1 0 1.9-1.1 1.6-2.1l-2-6.4V2"/><path d="M4.2 9h7.6"/></svg>',
    vent:
      '<svg viewBox="0 0 16 16"><path d="M3 13 13 3"/><path d="M6 3h7v7"/><circle cx="5" cy="11" r="1.4"/><circle cx="8" cy="8" r="1.4"/></svg>',
  };

  const KIND_COLORS = {
    inspect: DATA.COLORS.cyan,
    sample: DATA.COLORS.amber,
    vent: DATA.COLORS.pale,
  };

  const elements = {
    taskList: document.getElementById("taskList"),
    shiftList: document.getElementById("shiftList"),
    cabinList: document.getElementById("cabinPressureList"),
    jobsDone: document.getElementById("jobsDone"),
    missionClock: document.getElementById("missionClock"),
    tickerTime: document.getElementById("tickerTime"),
    ticker: document.getElementById("eventTicker"),
    runBadge: document.getElementById("runStateBadge"),
    canvasHint: document.getElementById("canvasHint"),
    robotOne: document.getElementById("robotOneState"),
    robotTwo: document.getElementById("robotTwoState"),
    accidents: document.getElementById("pressureAccidents"),
    interlock: document.getElementById("interlockStatus"),
    primary: document.getElementById("primaryAction"),
    primaryLabel: document.getElementById("primaryActionLabel"),
    edit: document.getElementById("editAction"),
    log: document.getElementById("logAction"),
    saveStatus: document.getElementById("saveStatus"),
    sound: document.getElementById("soundButton"),
    toast: document.getElementById("toast"),
    resultModal: document.getElementById("resultModal"),
    resultSequence: document.getElementById("resultSequence"),
    modalClose: document.getElementById("modalClose"),
    resultClose: document.getElementById("resultCloseAction"),
    download: document.getElementById("downloadAction"),
  };

  let mode = "archive";
  let replaySpeed = 1;
  let latestSnapshot = null;
  let pendingRoute = [];
  let activeRoute = [...DATA.DEFAULT_SEQUENCE];
  let archiveLog = loadStoredLog();
  let eventHistory = [];
  let lastUiPaint = 0;
  let toastTimer = 0;
  let hintTimer = 0;
  let soundTouched = false;

  if (!archiveLog) {
    archiveLog = Planner.buildMissionLog(DATA.DEFAULT_SEQUENCE, {
      completedAt: "2026-11-15T01:18:42.000Z",
    });
    saveLog(archiveLog);
  } else {
    activeRoute = archiveLog.taskOrder.map((task) => task.id);
  }

  const engine = new window.MissionEngine({
    audio,
    onUpdate(snapshot) {
      latestSnapshot = snapshot;
      if (performance.now() - lastUiPaint > 70) {
        lastUiPaint = performance.now();
        paint(snapshot);
      }
    },
    onEvent(record) {
      eventHistory.push(record);
      if (eventHistory.length > 30) eventHistory.shift();
      const previous = elements.ticker.querySelector("span");
      if (previous) previous.textContent = `${record.stamp}  ${record.message}`;
      elements.ticker.animate(
        [
          { opacity: 0.35, transform: "translateY(2px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 220, easing: "ease-out" },
      );
    },
    onComplete(log) {
      archiveLog = log;
      activeRoute = log.taskOrder.map((task) => task.id);
      saveLog(log);
      mode = "complete";
      paint(engine.getSnapshot(performance.now()));
      openResult(log);
    },
  });

  engine.setSpeed(replaySpeed);
  engine.setArchive(activeRoute);
  latestSnapshot = engine.getSnapshot(performance.now());
  bindEvents();
  paint(latestSnapshot);
  loadStoredLog();
  requestAnimationFrame(animateCanvas);

  function loadStoredLog() {
    try {
      const raw = localStorage.getItem(DATA.STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        parsed.schema === "t09.airlock-sortie/1" &&
        parsed.taskOrder &&
        parsed.taskOrder.length === 6
      ) {
        return parsed;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function saveLog(log) {
    try {
      localStorage.setItem(DATA.STORAGE_KEY, JSON.stringify(log));
    } catch (error) {
      showToast("本地存储不可用，请使用“导出任务日志”保存。");
    }
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  function paint(snapshot) {
    if (!snapshot) return;
    latestSnapshot = snapshot;
    renderTasks(snapshot);
    renderManifest(snapshot);
    renderPressures(snapshot);
    renderReadouts(snapshot);
    updateControls(snapshot);
  }

  function activeSequence() {
    return mode === "planning" ? pendingRoute : engine.route;
  }

  function planningSnapshot() {
    const snapshot = engine.getSnapshot(performance.now());
    snapshot.complete = false;
    snapshot.running = false;
    snapshot.completedTaskIds = [];
    snapshot.completedTasks = 0;
    snapshot.activeTaskIds = [];
    snapshot.activeCabinIds = [];
    snapshot.completedCabinIds = [];
    snapshot.pressureAccidents = 0;
    snapshot.interlockChecks = 0;
    snapshot.missionSeconds = 0;
    snapshot.showAllRoutes = false;
    snapshot.cabins = {};
    DATA.CABINS.forEach((cabin) => {
      snapshot.cabins[cabin.id] = {
        pressure: cabin.pressure,
        lockPressure: 1,
        innerOpen: 0,
        outerOpen: 0,
        equalizing: false,
        active: false,
        complete: false,
        phaseLabel: "",
      };
    });
    snapshot.robots = snapshot.robots.map((robot, index) => ({
      ...robot,
      active: false,
      taskId: null,
      phaseLabel: "待命 · DOCK",
      progress: 0,
      angle: index === 0 ? 0 : Math.PI,
      trail: [],
    }));
    return snapshot;
  }

  function paintPlanning() {
    paint(planningSnapshot());
  }

  function renderTasks(snapshot) {
    const sequence = activeSequence();
    const activeIds = snapshot.activeTaskIds || [];
    const doneIds = snapshot.completedTaskIds || engine.completedTaskIds || [];
    elements.taskList.innerHTML = DATA.TASKS.map((task) => {
      const order = sequence.indexOf(task.id);
      const isDone = doneIds.includes(task.id);
      const isActive = activeIds.includes(task.id);
      const isLoaded = order >= 0;
      const stateClass = isActive
        ? "is-active"
        : isDone
          ? "is-complete"
          : isLoaded
            ? "is-loaded"
            : "";
      return `
        <button
          type="button"
          class="task-card ${stateClass}"
          data-task="${task.id}"
          style="--kind-color:${KIND_COLORS[task.kind]}"
          aria-label="${task.title}"
        >
          <span class="task-glyph" aria-hidden="true">${ICONS[task.kind]}</span>
          <span class="task-copy">
            <span class="task-code">${task.id} / ${task.kindLabel}</span>
            <span class="task-title">${task.title}</span>
            <span class="task-cabin">${DATA.getCabin(task.cabinId).code} · ${DATA.getCabin(task.cabinId).name}</span>
          </span>
          <span class="task-side">
            <span class="priority-tag ${task.priority === "express" ? "" : "normal"}">${
              task.priority === "express" ? "高优先" : task.kindLabel
            }</span>
            <span class="task-order ${order >= 0 ? "is-set" : ""}">${
              isDone && mode !== "planning" ? "✓" : order >= 0 ? String(order + 1).padStart(2, "0") : "—"
            }</span>
          </span>
        </button>`;
    }).join("");
  }

  function renderManifest(snapshot) {
    const sequence = activeSequence();
    const doneIds = snapshot.completedTaskIds || [];
    const activeIds = snapshot.activeTaskIds || [];
    const shiftCount = 3;
    const groups = [];

    for (let shiftIndex = 0; shiftIndex < shiftCount; shiftIndex += 1) {
      const slice = sequence.slice(shiftIndex * 2, shiftIndex * 2 + 2);
      const tasks = slice.map((id) => DATA.getTask(id)).filter(Boolean);
      const done = tasks.length > 0 && tasks.every((task) => doneIds.includes(task.id));
      const active = tasks.some((task) => activeIds.includes(task.id));
      const live = mode === "running" && engine.shiftIndex === shiftIndex && !done;
      const hasPriority = tasks.some((task) => task.priority === "express");
      const hasGuard =
        shiftIndex >= 2 &&
        tasks.some((task) => task.priority !== "express") &&
        (mode === "archive" || mode === "complete" || tasks.length === 2);
      let headStatus = "QUEUED";
      if (done || mode === "archive" || mode === "complete") headStatus = "DONE";
      else if (live) headStatus = "LIVE";
      const headClass = done
        ? "is-done"
        : live
          ? "is-active"
          : "";

      const taskMarkup = tasks
        .map((task) => {
          const index = sequence.indexOf(task.id);
          const isDone = doneIds.includes(task.id);
          const isActive = activeIds.includes(task.id);
          const cabin = DATA.getCabin(task.cabinId);
          const orderClass = isDone ? "is-done" : isActive ? "is-active" : "";
          const marker =
            mode === "planning"
              ? `<button class="route-check" type="button" data-remove="${task.id}" aria-label="移除 ${task.title}">×</button>`
              : `<span class="route-check">${isDone ? "✓" : isActive ? "•" : "·"}</span>`;
          return `
            <div class="route-item ${orderClass}">
              <span class="route-index">${String(index + 1).padStart(2, "0")}</span>
              <span class="route-copy">
                <b>${task.title}</b>
                <span>${cabin.code} · ${task.kindLabel} · ${
                  task.priority === "express" ? "HIGH PRIORITY" : task.id
                }</span>
              </span>
              ${marker}
            </div>`;
        })
        .join("");

      const placeholder =
        tasks.length === 0
          ? `<div class="route-empty">${mode === "planning" ? "选择两项作业填入本班" : "NO TASK LOADED"}</div>`
          : tasks.length === 1 && mode === "planning"
            ? `<div class="route-empty">再选择一项作业</div>`
            : "";

      const tags = [
        hasPriority ? '<span class="shift-lock">HIGH LOCK 1/2</span>' : "",
        hasGuard ? '<span class="shift-lock">STARVE GUARD</span>' : "",
      ].join("");

      groups.push(`
        <div class="shift-group">
          <div class="shift-head ${headClass}">
            <span>SHIFT ${String(shiftIndex + 1).padStart(2, "0")} / ${headStatus}</span>
            <span>${tags || `${tasks.length} JOB${tasks.length === 1 ? "" : "S"}`}</span>
          </div>
          ${taskMarkup || placeholder}
        </div>`);
    }
    elements.shiftList.innerHTML = groups.join("");
    if (mode === "planning" && pendingRoute.length === 0) {
      elements.shiftList.insertAdjacentHTML(
        "afterbegin",
        '<div class="route-empty">还没有编排作业。<br>点击左侧作业加入序列，或使用“填入推荐顺序”。</div>',
      );
    }
  }

  function renderPressures(snapshot) {
    elements.cabinList.innerHTML = DATA.CABINS.map((cabin) => {
      const state = snapshot.cabins[cabin.id] || { pressure: cabin.pressure };
      const pressure = clampNumber(state.pressure, 0, 1.05);
      const low = pressure < 0.5;
      return `
        <div class="cabin-pressure ${low ? "is-low" : ""}">
          <span class="cabin-code">${cabin.code}</span>
          <span class="cabin-bar-wrap">
            <span class="cabin-name">
              <span>${cabin.name}</span>
              <span>${cabin.english}</span>
            </span>
            <span class="cabin-bar"><i style="transform:scaleX(${pressure.toFixed(3)})"></i></span>
          </span>
          <span class="cabin-value">${pressure.toFixed(2)}</span>
        </div>`;
    }).join("");
    const checks =
      mode === "archive" || mode === "complete" ? 18 : snapshot.interlockChecks || 0;
    elements.interlock.textContent =
      snapshot.pressureAccidents > 0
        ? `${checks} CHECKS / FAULT`
        : `${Math.min(18, snapshot.complete ? 18 : checks)} / 18 PASS`;
    elements.interlock.style.color =
      snapshot.pressureAccidents > 0 ? "var(--red)" : "var(--mint)";
  }

  function clampNumber(value, min, max) {
    const number = Number.isFinite(Number(value)) ? Number(value) : min;
    return Math.max(min, Math.min(max, number));
  }

  function renderReadouts(snapshot) {
    const robots = snapshot.robots || [];
    [elements.robotOne, elements.robotTwo].forEach((element, index) => {
      const robot = robots[index];
      if (!robot) {
        element.textContent = "未连接";
        return;
      }
      element.textContent = robot.taskId
        ? `${robot.taskId} · ${robot.phaseLabel}`
        : `待命 · DOCK 0${index + 1}`;
    });
    elements.accidents.textContent = String(snapshot.pressureAccidents || 0);
    elements.accidents.style.color =
      snapshot.pressureAccidents > 0 ? "var(--red)" : "var(--mint)";
  }

  function updateControls(snapshot) {
    elements.jobsDone.textContent = String(
      snapshot.completedTasks ?? (snapshot.completedTaskIds || []).length,
    );
    const clockSeconds = snapshot.complete
      ? mode === "archive"
        ? 11922
        : snapshot.missionSeconds
      : snapshot.missionSeconds;
    elements.missionClock.textContent = formatClock(clockSeconds);
    elements.tickerTime.textContent = `T+ ${formatClock(clockSeconds)}`;

    const badgeClass =
      mode === "running" ? "is-running" : snapshot.complete ? "is-complete" : "ghost";
    elements.runBadge.className = `status-badge ${badgeClass}`;
    elements.runBadge.innerHTML = `<i></i> ${
      mode === "running"
        ? "LIVE SORTIE"
        : mode === "planning"
          ? "PLAN MODE"
          : snapshot.complete
            ? "CERTIFIED RUN"
            : "ARCHIVED RUN"
    }`;

    if (mode === "running") {
      elements.primaryLabel.textContent = "试航进行中";
      elements.primary.disabled = true;
    } else if (mode === "planning") {
      const missing = DATA.TASKS.length - pendingRoute.length;
      elements.primaryLabel.textContent = missing ? `还需 ${missing} 项作业` : "启动试航";
      elements.primary.disabled = missing !== 0;
    } else {
      elements.primaryLabel.textContent = mode === "complete" ? "再次回放" : "重放本局";
      elements.primary.disabled = false;
    }

    elements.edit.disabled = mode === "running";
    if (mode === "planning") {
      elements.edit.textContent = pendingRoute.length ? "清空重排" : "填入推荐顺序";
    } else if (mode === "running") {
      elements.edit.textContent = "运行中";
    } else {
      elements.edit.textContent = "重新编排";
    }
    elements.log.disabled = mode === "running";
    elements.log.style.opacity = mode === "running" ? "0.4" : "";

    elements.saveStatus.innerHTML = `<i></i> ${
      mode === "running"
        ? "遥测记录写入中"
        : mode === "planning"
          ? "等待新序列"
          : "RUN #004 已存档"
    }`;
    elements.canvasHint.classList.toggle("is-hidden", mode !== "archive");
    if (mode === "planning") {
      elements.canvasHint.textContent = pendingRoute.length
        ? `已编排 ${pendingRoute.length} / 6 项作业`
        : "点击左侧作业编排本局任务顺序";
      elements.canvasHint.classList.remove("is-hidden");
    }
    if (mode === "running") {
      elements.canvasHint.textContent = `SHIFT ${String(engine.shiftIndex + 1).padStart(2, "0")} · 压力平衡联锁生效`;
      elements.canvasHint.classList.remove("is-hidden");
      window.clearTimeout(hintTimer);
      hintTimer = window.setTimeout(
        () => elements.canvasHint.classList.add("is-hidden"),
        1800,
      );
    }
  }

  function bindEvents() {
    elements.taskList.addEventListener("click", (event) => {
      const card = event.target.closest("[data-task]");
      if (!card) return;
      const taskId = card.dataset.task;
      if (mode === "running") {
        showToast("试航运行中，等待本局结束后再调整序列。");
        return;
      }
      if (mode !== "planning") {
        mode = "planning";
        pendingRoute = [];
        elements.ticker.querySelector("span").textContent =
          "编排模式：选择六项作业，系统将按两两一班执行并检查气闸压差。";
      }
      if (pendingRoute.includes(taskId)) {
        showToast(`${taskId} 已在任务序列中。`);
        return;
      }
      pendingRoute.push(taskId);
      paintPlanning();
      if (pendingRoute.length === DATA.TASKS.length) {
        showToast("六项作业已齐，可启动试航。");
      }
    });

    elements.shiftList.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove]");
      if (!remove || mode !== "planning") return;
      pendingRoute = pendingRoute.filter((id) => id !== remove.dataset.remove);
      paintPlanning();
    });

    elements.primary.addEventListener("click", () => {
      if (mode === "planning") {
        launch(pendingRoute);
      } else {
        launch(activeRoute);
      }
    });

    elements.edit.addEventListener("click", () => {
      if (mode === "running") return;
      if (mode === "planning" && pendingRoute.length === 0) {
        pendingRoute = [...DATA.DEFAULT_SEQUENCE];
        showToast("已填入 #004 推荐顺序。");
      } else if (mode === "planning") {
        pendingRoute = [];
        showToast("任务序列已清空。");
      } else {
        mode = "planning";
        pendingRoute = [];
        elements.ticker.querySelector("span").textContent =
          "编排模式：选择六项作业，系统将按两两一班执行并检查气闸压差。";
        showToast("选择六项作业，机器人将按两两一班执行。");
      }
      if (mode === "planning") {
        paintPlanning();
      }
    });

    document.querySelectorAll("[data-speed]").forEach((button) => {
      button.addEventListener("click", () => {
        replaySpeed = Number(button.dataset.speed);
        engine.setSpeed(replaySpeed);
        document.querySelectorAll("[data-speed]").forEach((item) => {
          item.classList.toggle("active", Number(item.dataset.speed) === replaySpeed);
        });
      });
    });

    elements.sound.addEventListener("click", async () => {
      soundTouched = true;
      const enabled = await audio.setEnabled(!audio.enabled);
      updateSoundButton(enabled);
      showToast(enabled ? "气阀与电机声音已开启。" : "声音已关闭。");
    });

    elements.log.addEventListener("click", () => {
      if (mode === "running") return;
      downloadLog(archiveLog);
    });

    elements.download.addEventListener("click", () => downloadLog(archiveLog));
    elements.modalClose.addEventListener("click", closeResult);
    elements.resultClose.addEventListener("click", closeResult);
    elements.resultModal.addEventListener("click", (event) => {
      if (event.target === elements.resultModal) closeResult();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeResult();
    });
  }

  async function launch(sequence) {
    if (mode === "running") return;
    if (sequence.length !== DATA.TASKS.length) {
      showToast("需要先编排六项舱内作业。");
      return;
    }
    const validation = Planner.validateSequence(sequence);
    if (!validation.valid) {
      showToast(validation.errors[0]);
      return;
    }
    if (!soundTouched) {
      await audio.setEnabled(true);
      updateSoundButton(audio.enabled);
    }
    mode = "running";
    eventHistory = [];
    elements.ticker.querySelector("span").textContent = "试航启动：压力平衡与舱门联锁检查中。";
    closeResult();
    const result = engine.start(sequence, replaySpeed);
    if (result && !result.valid) {
      mode = "planning";
      showToast(result.errors[0]);
      return;
    }
    activeRoute = [...sequence];
    pendingRoute = [];
    paint(engine.getSnapshot(performance.now()));
  }

  function updateSoundButton(enabled) {
    elements.sound.classList.toggle("is-on", enabled);
    elements.sound.querySelector(".sound-label").textContent = enabled
      ? "SOUND ON"
      : "SOUND OFF";
    elements.sound.setAttribute("aria-label", enabled ? "关闭声音" : "开启声音");
  }

  function downloadLog(log) {
    const payload = JSON.stringify(log, null, 2);
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "t09-sortie-004-task-order.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("完整任务顺序与事件日志已导出。");
  }

  function openResult(log) {
    elements.resultSequence.innerHTML = log.taskOrder
      .map(
        (task) =>
          `<li><b>${task.title}</b><span>SHIFT ${task.shift} / ${task.cabin} · ${task.id}</span></li>`,
      )
      .join("");
    elements.resultModal.classList.add("is-open");
    elements.resultModal.setAttribute("aria-hidden", "false");
  }

  function closeResult() {
    elements.resultModal.classList.remove("is-open");
    elements.resultModal.setAttribute("aria-hidden", "true");
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2600);
  }

  function animateCanvas(stamp) {
    if (latestSnapshot) renderer.render(latestSnapshot, stamp);
    requestAnimationFrame(animateCanvas);
  }

  updateSoundButton(false);
  saveLog(archiveLog);
})();
