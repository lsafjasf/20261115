/* Browser UI controller: selection, dispatch, speed control, panels and export. */

const FIXED_SEED = 20261115;

class AmbulanceApp {
  constructor() {
    this.canvas = document.getElementById("map");
    this.ctx = this.canvas.getContext("2d");
    this.sound = new SoundBoard();
    this.engine = new GameEngine(new Rng(FIXED_SEED), MAP);
    this.selectedAmbulance = null;
    this.selectedPatient = null;
    this.hover = {};
    this.lastFrame = performance.now();
    this.lastLogCount = 0;
    this._bindEvents();
    this._renderPanels();
    requestAnimationFrame((stamp) => this._frame(stamp));
  }

  _bindEvents() {
    this.canvas.addEventListener("click", (event) => this._handleClick(event));
    this.canvas.addEventListener("mousemove", (event) => this._handleHover(event));
    document.getElementById("priority").addEventListener("change", (event) => {
      if (this.selectedAmbulance) {
        const ambulance = this.engine.ambulanceById(this.selectedAmbulance);
        if (ambulance.mission) this.engine.setPriority(ambulance.id, event.target.value);
      }
    });
    document.getElementById("hospital-select").addEventListener("change", (event) => {
      if (this.selectedAmbulance) {
        const ambulance = this.engine.ambulanceById(this.selectedAmbulance);
        if (ambulance.mission) this.engine.setTargetHospital(ambulance.id, event.target.value);
      }
    });
    document.getElementById("dispatch-btn").addEventListener("click", () => this._dispatchSelected());
    document.getElementById("return-btn").addEventListener("click", () => this._returnSelected());
    document.getElementById("mute-btn").addEventListener("click", () => {
      const muted = this.sound.toggleMute();
      document.getElementById("mute-btn").textContent = muted ? "🔇 已静音" : "🔊 声音";
    });
    for (const button of document.querySelectorAll(".speed-btn")) {
      button.addEventListener("click", () => {
        this.engine.speedMultiplier = Number(button.dataset.speed);
        document.querySelectorAll(".speed-btn").forEach((item) => item.classList.toggle("active", item === button));
      });
    }
    document.getElementById("export-json").addEventListener("click", () => this._export("json"));
    document.getElementById("export-csv").addEventListener("click", () => this._export("csv"));
    document.getElementById("restart-btn").addEventListener("click", () => this._restart());
  }

  _handleClick(event) {
    const point = this._canvasPoint(event);
    const ambulance = this._hitAmbulance(point);
    const patient = this._hitPatient(point);
    if (ambulance) {
      this.selectedAmbulance = this.selectedAmbulance === ambulance.id ? null : ambulance.id;
      this._renderPanels();
      return;
    }
    if (patient) {
      this.selectedPatient = this.selectedPatient === patient.id ? null : patient.id;
      this._renderPanels();
    }
  }

  _handleHover(event) {
    const point = this._canvasPoint(event);
    this.hover = {
      ambulanceId: this._hitAmbulance(point)?.id ?? null,
      patientId: this._hitPatient(point)?.id ?? null,
    };
    this.canvas.style.cursor = this.hover.ambulanceId || this.hover.patientId ? "pointer" : "default";
  }

  _canvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * this.canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * this.canvas.height,
    };
  }

  _hitAmbulance(point) {
    return this.engine.ambulances.find((ambulance) => Math.hypot(ambulance.x - point.x, ambulance.y - point.y) <= 16);
  }

  _hitPatient(point) {
    return this.engine.patients.find((patient) => {
      if (patient.state === "delivered") return false;
      const anchor = this.engine.map.nodeXY(patient.node);
      return Math.hypot(anchor.x - point.x, anchor.y - point.y) <= 16;
    });
  }

  _dispatchSelected() {
    if (!this.selectedAmbulance || !this.selectedPatient) {
      this.sound.warn();
      return;
    }
    const priority = document.getElementById("priority").value;
    const hospitalId = document.getElementById("hospital-select").value;
    const result = this.engine.dispatch(this.selectedAmbulance, this.selectedPatient, hospitalId || null, priority);
    if (result.ok) {
      this.sound.siren();
      this.selectedPatient = null;
    } else {
      this.sound.warn();
      alert(result.error);
    }
    this._renderPanels();
  }

  _returnSelected() {
    if (!this.selectedAmbulance) return;
    const result = this.engine.returnToDepot(this.selectedAmbulance);
    if (!result.ok) this.sound.warn();
    else this.sound.confirm();
  }

  _restart() {
    this.engine = new GameEngine(new Rng(FIXED_SEED), MAP);
    this.selectedAmbulance = null;
    this.selectedPatient = null;
    this.lastLogCount = 0;
    this._renderPanels();
  }

  _frame(stamp) {
    const dt = Math.min(0.1, (stamp - this.lastFrame) / 1000);
    this.lastFrame = stamp;
    const beforeDelivered = this.engine.patients.filter((patient) => patient.state === "delivered").length;
    const beforeFinished = this.engine.finished;
    this.engine.update(dt);
    const afterDelivered = this.engine.patients.filter((patient) => patient.state === "delivered").length;
    if (afterDelivered > beforeDelivered) this.sound.deliver();
    if (!beforeFinished && this.engine.finished) this.sound.result(this.engine.result.success);
    drawScene(this.ctx, this.engine, {
      ambulanceId: this.hover.ambulanceId ?? this.selectedAmbulance,
      patientId: this.hover.patientId ?? this.selectedPatient,
    });
    this._renderHud();
    this._renderLogTail();
    requestAnimationFrame((next) => this._frame(next));
  }

  _renderHud() {
    const remaining = Math.max(0, 600 - this.engine.time);
    const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
    const seconds = String(Math.floor(remaining % 60)).padStart(2, "0");
    document.getElementById("timer").textContent = `${minutes}:${seconds}`;
    const delivered = this.engine.patients.filter((patient) => patient.state === "delivered").length;
    document.getElementById("progress").textContent = `${delivered}/5 单（目标 4 单）`;
    const result = this.engine.result;
    document.getElementById("result").textContent = result
      ? `${result.success ? "✅ 成功" : "❌ 失败"}：${result.reason}`
      : "进行中";
    document.getElementById("seed-label").textContent = `seed ${FIXED_SEED}`;
  }

  _renderPanels() {
    this._renderFleet();
    this._renderPatients();
    this._renderHospitals();
  }

  _renderFleet() {
    const panel = document.getElementById("fleet-panel");
    panel.innerHTML = this.engine.ambulances.map((ambulance) => {
      const active = this.selectedAmbulance === ambulance.id ? "active" : "";
      const modeText = {
        idle: "空闲",
        maintenance: `维修 ${Math.ceil(ambulance.repairRemaining)}s`,
        toPatient: "前往现场",
        loading: "现场处置",
        toHospital: "送医途中",
        queued: "等待床位",
        returning: "返场加油",
        stranded: "抛锚",
      }[ambulance.mode];
      return `<button class="card ${active}" data-ambulance="${ambulance.id}">
        <b>${ambulance.name}</b>
        <span>${modeText} · 医护 ${ambulance.crew} 人</span>
        <span>油量 <meter min="0" max="100" value="${ambulance.fuel}"></meter> ${Math.round(ambulance.fuel)}</span>
      </button>`;
    }).join("");
    panel.querySelectorAll("[data-ambulance]").forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedAmbulance = button.dataset.ambulance;
        this._renderPanels();
      });
    });
  }

  _renderPatients() {
    const panel = document.getElementById("patient-panel");
    panel.innerHTML = this.engine.patients.map((patient) => {
      const active = this.selectedPatient === patient.id ? "active" : "";
      const stateText = {
        waiting: patient.assignedTo ? `已派 ${patient.assignedTo}` : "等待救援",
        picked: "送医中",
        delivered: `已送达 ${Math.round(patient.successRate * 100)}%`,
        failed: "失败",
      }[patient.state];
      const severityText = { critical: "危重", serious: "重伤", moderate: "轻症" }[patient.severity];
      return `<button class="card ${active}" data-patient="${patient.id}" ${patient.state !== "waiting" || patient.assignedTo ? "disabled" : ""}>
        <b>${patient.id} · ${patient.label}</b>
        <span>${severityText} · 需 ${patient.crewNeed} 人 · 黄金 ${patient.golden}s</span>
        <span>${stateText} · 当前成功率 ${Math.round(patient.successRate * 100)}%</span>
      </button>`;
    }).join("");
    panel.querySelectorAll("[data-patient]").forEach((button) => {
      button.addEventListener("click", () => {
        this.selectedPatient = button.dataset.patient;
        this._renderPanels();
      });
    });
  }

  _renderHospitals() {
    const panel = document.getElementById("hospital-panel");
    panel.innerHTML = this.engine.hospitals.map((hospital) =>
      `<div class="hospital-row"><b>${hospital.name}</b><span>空床 ${hospital.beds} · 等候 ${hospital.waiting}</span></div>`,
    ).join("");
  }

  _renderLogTail() {
    if (this.engine.logs.length === this.lastLogCount) return;
    this.lastLogCount = this.engine.logs.length;
    const box = document.getElementById("log-box");
    box.innerHTML = this.engine.logs.slice(-40).reverse().map((entry) =>
      `<div class="log-line"><time>${formatTime(entry.time)}</time><span class="tag ${entry.type.toLowerCase()}">${entry.title}</span>${entry.detail}</div>`,
    ).join("");
  }

  _export(kind) {
    const data = this.engine.exportData();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let blob;
    let filename;
    if (kind === "json") {
      blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      filename = `dispatch-seed-${FIXED_SEED}-${stamp}.json`;
    } else {
      blob = new Blob([toCsv(data.dispatchRecords)], { type: "text/csv;charset=utf-8" });
      filename = `dispatch-seed-${FIXED_SEED}-${stamp}.csv`;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    this.sound.confirm();
  }
}

function formatTime(value) {
  const minutes = String(Math.floor(value / 60)).padStart(2, "0");
  const seconds = String(Math.floor(value % 60)).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function toCsv(records) {
  const header = ["dispatchId", "time", "ambulanceId", "patientId", "patientLabel", "severity", "hospitalId", "priority", "status", "pickedAt", "deliveredAt", "successRate", "outcome", "note"];
  const rows = records.map((record) => header.map((key) => csvCell(record[key])).join(","));
  return [header.join(","), ...rows].join("\n");
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/"/g, '""');
  return /[",\n]/.test(text) ? `"${text}"` : text;
}

window.addEventListener("DOMContentLoaded", () => {
  window.app = new AmbulanceApp();
});
