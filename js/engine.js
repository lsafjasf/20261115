/* Ambulance dispatch simulation engine. Isomorphic: browser and Node share it. */

const AmbulanceMap =
  typeof globalThis !== "undefined" && globalThis.__AMBULANCE_MAP__
    ? globalThis.__AMBULANCE_MAP__
    : typeof require === "function"
      ? require("./map.js")
      : null;
const { buildGraph, shortestPath } = AmbulanceMap;

const ROUND_SECONDS = 600; // 10-minute round
const BASE_SPEED = 62; // pixels per second on clear road
const FUEL_PER_PIXEL = 0.035;
const REFUEL_RATE = 18; // fuel units per second at depot
const LOAD_SECONDS = 8; // on-scene treatment / loading time

const TRAFFIC_LEVELS = [
  { label: "畅通", factor: 0.9, color: "#22c55e" },
  { label: "缓行", factor: 1.0, color: "#a3e635" },
  { label: "拥堵", factor: 1.5, color: "#f59e0b" },
  { label: "严重拥堵", factor: 2.2, color: "#ef4444" },
];

const PATIENT_TEMPLATES = [
  { id: "P1", district: "D1", severity: "critical", crewNeed: 3, golden: 90, decay: 0.55, label: "心脏骤停" },
  { id: "P2", district: "D2", severity: "serious", crewNeed: 2, golden: 150, decay: 0.35, label: "交通事故多发伤" },
  { id: "P3", district: "D3", severity: "moderate", crewNeed: 2, golden: 240, decay: 0.22, label: "跌倒骨折" },
  { id: "P4", district: "D4", severity: "serious", crewNeed: 2, golden: 150, decay: 0.35, label: "呼吸困难" },
  { id: "P5", district: "D5", severity: "moderate", crewNeed: 1, golden: 270, decay: 0.2, label: "轻度外伤" },
];

const AMBULANCE_TEMPLATES = [
  { id: "A1", fuel: 100, crew: 3, status: "ready", name: "救护车 1 号" },
  { id: "A2", fuel: 62, crew: 2, status: "ready", name: "救护车 2 号" },
  { id: "A3", fuel: 48, crew: 1, status: "maintenance", name: "救护车 3 号" },
];

const MAINTENANCE_REPAIR_SECONDS = 45;

class GameEngine {
  constructor(rng, map, options = {}) {
    this.rng = rng;
    this.map = map;
    this.time = 0;
    this.finished = false;
    this.result = null;
    this.speedMultiplier = options.speedMultiplier ?? 1;
    this.logs = [];
    this.dispatchRecords = [];
    this.nextEventAt = { traffic: 12, beds: 20 };

    this.trafficFactor = {};
    for (const edge of map.edges) {
      this.trafficFactor[edgeKeyOf(edge.a, edge.b)] = TRAFFIC_LEVELS[1].factor;
    }

    this.hospitals = map.hospitals.map((hospital) => ({
      ...hospital,
      beds: hospital.initialBeds,
      capacity: hospital.initialBeds,
      waiting: 0,
    }));

    this.patients = PATIENT_TEMPLATES.map((template) => {
      const district = map.districts.find((item) => item.id === template.district);
      return {
        ...template,
        node: district.node,
        state: "waiting", // waiting -> picked -> delivered
        assignedTo: null,
        spawnAt: 0,
        pickedAt: null,
        deliveredAt: null,
        hospital: null,
        successRate: 1,
        outcome: null,
      };
    });

    this.ambulances = AMBULANCE_TEMPLATES.map((template) => {
      const repairRemaining = template.status === "maintenance" ? MAINTENANCE_REPAIR_SECONDS : 0;
      return {
        ...template,
        node: map.depot.node,
        x: map.nodeXY(map.depot.node).x,
        y: map.nodeXY(map.depot.node).y,
        mode: template.status === "maintenance" ? "maintenance" : "idle",
        repairRemaining,
        mission: null,
        path: [],
        segment: null,
        carriedPatient: null,
        loadRemaining: 0,
        distance: 0,
        dispatches: 0,
        usable: true,
      };
    });

    this._record("SYSTEM", "开局", `固定 seed=${rng.seed}，五个街区同时呼叫，时限 ${ROUND_SECONDS} 秒`);
  }

  get graph() {
    return buildGraph(this.map, this.trafficFactor);
  }

  ambulanceById(id) {
    return this.ambulances.find((item) => item.id === id);
  }

  patientById(id) {
    return this.patients.find((item) => item.id === id);
  }

  hospitalById(id) {
    return this.hospitals.find((item) => item.id === id);
  }

  _record(type, title, detail) {
    const entry = {
      seq: this.logs.length + 1,
      time: round1(this.time),
      type,
      title,
      detail,
    };
    this.logs.push(entry);
    return entry;
  }

  /* Player action: send an idle ambulance to a waiting casualty. */
  dispatch(ambulanceId, patientId, hospitalId = null, priority = "fastest") {
    if (this.finished) return { ok: false, error: "本局已结束" };
    const ambulance = this.ambulanceById(ambulanceId);
    const patient = this.patientById(patientId);
    if (!ambulance || !patient) return { ok: false, error: "车辆或伤员不存在" };
    if (ambulance.mode !== "idle") return { ok: false, error: "该车辆当前不可派遣" };
    if (ambulance.fuel <= 0) return { ok: false, error: "油量不足" };
    if (patient.state !== "waiting" || patient.assignedTo) {
      return { ok: false, error: "该伤员已有派遣，不能重复调派" };
    }
    if (ambulance.crew < patient.crewNeed) {
      return { ok: false, error: `医护人数不足，需要 ${patient.crewNeed} 人` };
    }
    let hospital = hospitalId ? this.hospitalById(hospitalId) : this._autoHospital();
    if (!hospital) hospital = this.hospitals[0];
    const fuelNeeded = this._estimateFuelNeeded(ambulance, patient, hospital);
    if (ambulance.fuel < fuelNeeded) {
      return { ok: false, error: `油量不足以完成全程（需约 ${fuelNeeded.toFixed(1)}，当前 ${ambulance.fuel.toFixed(1)}），请先返场加油` };
    }

    const record = {
      dispatchId: `D${this.dispatchRecords.length + 1}`,
      time: round1(this.time),
      ambulanceId,
      patientId,
      hospitalId: hospital.id,
      priority,
      patientLabel: patient.label,
      severity: patient.severity,
      status: "enroute",
      pickedAt: null,
      deliveredAt: null,
      successRate: null,
      outcome: null,
      note: "",
    };
    this.dispatchRecords.push(record);
    this._beginLeg(ambulance, patient.node, "toPatient");
    ambulance.mode = "toPatient";
    ambulance.mission = { patientId, hospitalId: hospital.id, priority, record };
    ambulance.dispatches += 1;
    patient.assignedTo = ambulance.id;
    this._record("DISPATCH", "调派", `${ambulance.id} 前往 ${patient.id}（${patient.label}），目标 ${hospital.name}，路径策略：${priorityLabel(priority)}`);
    return { ok: true, record };
  }

  /* Player action: idle ambulance returns to depot for refuel. */
  returnToDepot(ambulanceId) {
    if (this.finished) return { ok: false, error: "本局已结束" };
    const ambulance = this.ambulanceById(ambulanceId);
    if (!ambulance || ambulance.mode !== "idle") return { ok: false, error: "仅空闲车辆可返场" };
    if (ambulance.node === this.map.depot.node) return { ok: false, error: "车辆已在车库" };
    this._beginLeg(ambulance, this.map.depot.node, "returning");
    ambulance.mode = "returning";
    this._record("ORDER", "返场加油", `${ambulance.id} 收到返场指令`);
    return { ok: true };
  }

  /* Player action: reroute running mission with a different path priority. */
  setPriority(ambulanceId, priority) {
    const ambulance = this.ambulanceById(ambulanceId);
    if (!ambulance || !ambulance.mission) return { ok: false, error: "该车辆没有在途任务" };
    ambulance.mission.priority = priority;
    if (ambulance.mode === "toPatient" || ambulance.mode === "toHospital") this._replan(ambulance);
    this._record("ORDER", "路径优先级", `${ambulance.id} 切换为「${priorityLabel(priority)}」并重新规划路径`);
    return { ok: true };
  }

  setTargetHospital(ambulanceId, hospitalId) {
    const ambulance = this.ambulanceById(ambulanceId);
    const hospital = this.hospitalById(hospitalId);
    if (!ambulance || !hospital || !ambulance.mission) return { ok: false, error: "无法切换目标医院" };
    ambulance.mission.hospitalId = hospitalId;
    if (ambulance.mode === "toHospital") this._replan(ambulance);
    this._record("ORDER", "更换医院", `${ambulance.id} 目标改为 ${hospital.name}`);
    return { ok: true };
  }

  _autoHospital() {
    return [...this.hospitals].sort((a, b) => b.beds - a.beds)[0];
  }

  _pathFor(ambulance, targetNode) {
    const graph = this.graph;
    if (!ambulance.mission || ambulance.mission.priority === "fastest") {
      return shortestPath(this.map, graph, ambulance.node, targetNode);
    }
    // "shortest" ignores live congestion: pure geometric distance.
    const flat = buildGraph(this.map, {});
    return shortestPath(this.map, flat, ambulance.node, targetNode);
  }

  _beginLeg(ambulance, targetNode, mode) {
    ambulance.path = this._pathFor(ambulance, targetNode);
    ambulance.node = ambulance.path[0];
    ambulance.segment = { index: 0, targetNode: ambulance.path[1] ?? targetNode, progress: 0, length: 0 };
    const firstTarget = ambulance.segment.targetNode;
    const edge = this.map.edges.find(
      (item) => edgeKeyOf(item.a, item.b) === edgeKeyOf(ambulance.node, firstTarget),
    );
    ambulance.segment.length = edge ? edge.length : 0;
    if (mode) ambulance.mode = mode;
  }

  _replan(ambulance) {
    let target;
    if (ambulance.mode === "toPatient") {
      target = this.patientById(ambulance.mission.patientId).node;
    } else if (ambulance.mode === "toHospital") {
      target = this.hospitalById(ambulance.mission.hospitalId).node;
    } else {
      target = this.map.depot.node;
    }
    this._beginLeg(ambulance, target, ambulance.mode);
  }

  _estimateFuelNeeded(ambulance, patient, hospital) {
    const graph = buildGraph(this.map, {});
    const toPatient = pathLength(this.map, graph, ambulance.node, patient.node);
    const toHospital = pathLength(this.map, graph, patient.node, hospital.node);
    return (toPatient + toHospital) * FUEL_PER_PIXEL * 1.15;
  }

  update(rawDt) {
    if (this.finished) return;
    let remaining = rawDt * this.speedMultiplier;
    while (remaining > 0 && !this.finished) {
      const dt = Math.min(0.1, remaining);
      remaining -= dt;
      this.time = round1(this.time + dt);
      this._runScheduledEvents();
      for (const ambulance of this.ambulances) this._updateAmbulance(ambulance, dt);
      this._updateSuccessRates();
      if (this.time >= ROUND_SECONDS) this._finish();
    }
  }

  _runScheduledEvents() {
    if (this.time >= this.nextEventAt.traffic) {
      this.nextEventAt.traffic = round1(this.time + this.rng.int(9, 15));
      const changes = this.rng.int(1, 2);
      for (let i = 0; i < changes; i += 1) {
        const edge = this.rng.pick(this.map.edges);
        const roll = this.rng.float();
        const levelIndex = roll < 0.3 ? 0 : roll < 0.62 ? 1 : roll < 0.88 ? 2 : 3;
        const level = TRAFFIC_LEVELS[levelIndex];
        this.trafficFactor[edgeKeyOf(edge.a, edge.b)] = level.factor;
        this._record("TRAFFIC", "路况变化", `路段 ${edge.a}↔${edge.b} 变为「${level.label}」`);
      }
    }
    if (this.time >= this.nextEventAt.beds) {
      this.nextEventAt.beds = round1(this.time + this.rng.int(16, 26));
      const hospital = this.rng.pick(this.hospitals);
      if (this.rng.float() < 0.55 && hospital.beds < hospital.capacity + 1) {
        hospital.beds += 1;
        this._record("BEDS", "床位释放", `${hospital.name} 出院一张床位，当前可用 ${hospital.beds}`);
      } else if (hospital.beds > 0) {
        hospital.beds -= 1;
        this._record("BEDS", "床位紧张", `${hospital.name} 收治激增，当前可用 ${hospital.beds}`);
      }
      this._admitQueued();
    }
  }

  _updateAmbulance(ambulance, dt) {
    if (ambulance.mode === "maintenance") {
      ambulance.repairRemaining = Math.max(0, ambulance.repairRemaining - dt);
      if (ambulance.repairRemaining === 0) {
        ambulance.mode = "idle";
        ambulance.status = "ready";
        this._record("FLEET", "维修完成", `${ambulance.id} 解除保养，可接受调派`);
      }
      return;
    }
    if (ambulance.mode === "idle") {
      if (ambulance.status === "ready" && ambulance.node === this.map.depot.node && ambulance.fuel < 100) {
        ambulance.fuel = Math.min(100, ambulance.fuel + REFUEL_RATE * dt);
      } else if (ambulance.status === "ready" && ambulance.node !== this.map.depot.node && ambulance.fuel > 0) {
        this._beginLeg(ambulance, this.map.depot.node, "returning");
        this._record("FLEET", "自动返场", `${ambulance.id} 空闲，自动返回车库加油`);
      }
      return;
    }
    if (ambulance.mode === "loading") {
      ambulance.loadRemaining -= dt;
      if (ambulance.loadRemaining <= 0) {
        const patient = this.patientById(ambulance.mission.patientId);
        patient.state = "picked";
        patient.pickedAt = round1(this.time);
        ambulance.mission.record.pickedAt = patient.pickedAt;
        const hospital = this.hospitalById(ambulance.mission.hospitalId);
        this._beginLeg(ambulance, hospital.node, "toHospital");
        this._record("TREAT", "接走伤员", `${ambulance.id} 现场处置完成，搭载 ${patient.id} 前往 ${hospital.name}`);
      }
      return;
    }
    if (ambulance.mode === "queued") {
      this._admitQueued();
      return;
    }
    if (ambulance.mode === "stranded") return;
    this._drive(ambulance, dt);
  }

  _drive(ambulance, dt) {
    const segment = ambulance.segment;
    if (!segment || segment.length === 0) {
      this._arrive(ambulance);
      return;
    }
    const factor = this.trafficFactor[edgeKeyOf(ambulance.node, segment.targetNode)] ?? 1;
    const speed = BASE_SPEED / factor;
    const distance = Math.min(segment.length - segment.progress, speed * dt);
    segment.progress += distance;
    ambulance.distance += distance;
    ambulance.fuel = Math.max(0, ambulance.fuel - distance * FUEL_PER_PIXEL);

    const from = this.map.nodeXY(ambulance.node);
    const to = this.map.nodeXY(segment.targetNode);
    const ratio = segment.progress / segment.length;
    ambulance.x = from.x + (to.x - from.x) * ratio;
    ambulance.y = from.y + (to.y - from.y) * ratio;

    if (ambulance.fuel <= 0) {
      ambulance.mode = "stranded";
      ambulance.usable = false;
      this._failMission(ambulance, "燃油耗尽抛锚");
      return;
    }
    if (segment.progress >= segment.length) {
      ambulance.node = segment.targetNode;
      const nextIndex = segment.index + 1;
      if (nextIndex >= ambulance.path.length - 1) {
        this._arrive(ambulance);
      } else {
        const nextNode = ambulance.path[nextIndex + 1];
        const edge = this.map.edges.find(
          (item) => edgeKeyOf(item.a, item.b) === edgeKeyOf(ambulance.node, nextNode),
        );
        ambulance.segment = { index: nextIndex, targetNode: nextNode, progress: 0, length: edge ? edge.length : 0 };
        const p = this.map.nodeXY(ambulance.node);
        ambulance.x = p.x;
        ambulance.y = p.y;
      }
    }
  }

  _arrive(ambulance) {
    const point = this.map.nodeXY(ambulance.node);
    ambulance.x = point.x;
    ambulance.y = point.y;
    if (ambulance.mode === "toPatient") {
      const patient = this.patientById(ambulance.mission.patientId);
      patient.pickedAt = round1(this.time);
      ambulance.mode = "loading";
      ambulance.loadRemaining = LOAD_SECONDS;
      this._record("SCENE", "抵达现场", `${ambulance.id} 到达 ${patient.id}（${patient.label}），开始现场处置`);
    } else if (ambulance.mode === "toHospital") {
      const hospital = this.hospitalById(ambulance.mission.hospitalId);
      if (hospital.beds > 0) {
        this._admit(ambulance, hospital);
      } else {
        ambulance.mode = "queued";
        hospital.waiting += 1;
        this._record("QUEUE", "等待床位", `${ambulance.id} 抵达 ${hospital.name} 但无空床，随车等候`);
      }
    } else if (ambulance.mode === "returning") {
      ambulance.mode = "idle";
      this._record("FLEET", "返场完成", `${ambulance.id} 回到车库，开始自动加油`);
    }
  }

  _admitQueued() {
    for (const ambulance of this.ambulances) {
      if (ambulance.mode !== "queued") continue;
      const hospital = this.hospitalById(ambulance.mission.hospitalId);
      if (hospital.beds > 0) this._admit(ambulance, hospital);
    }
  }

  _admit(ambulance, hospital) {
    if (ambulance.mode === "queued") hospital.waiting = Math.max(0, hospital.waiting - 1);
    hospital.beds = Math.max(0, hospital.beds - 1);
    const patient = this.patientById(ambulance.mission.patientId);
    patient.state = "delivered";
    patient.deliveredAt = round1(this.time);
    patient.hospital = hospital.id;
    patient.successRate = this._successRate(patient);
    patient.outcome = patient.successRate >= 0.5 ? "saved" : "risky";

    const record = ambulance.mission.record;
    record.status = "delivered";
    record.deliveredAt = patient.deliveredAt;
    record.successRate = patient.successRate;
    record.outcome = patient.outcome;
    record.note = `送达 ${hospital.name}，剩余床位 ${hospital.beds}`;

    ambulance.mode = "idle";
    ambulance.carriedPatient = null;
    ambulance.mission = null;
    ambulance.path = [];
    ambulance.segment = null;
    this._record(
      "DELIVER",
      "完成一单",
      `${patient.id} 送达 ${hospital.name}，成功率 ${Math.round(patient.successRate * 100)}%`,
    );
  }

  _failMission(ambulance, reason) {
    const mission = ambulance.mission;
    if (mission) {
      const patient = this.patientById(mission.patientId);
      patient.state = "failed";
      patient.outcome = "failed";
      mission.record.status = "failed";
      mission.record.outcome = "failed";
      mission.record.note = reason;
    }
    ambulance.mission = null;
    this._record("FAILURE", "任务失败", `${ambulance.id}：${reason}`);
  }

  _successRate(patient) {
    const elapsed = patient.deliveredAt ?? this.time;
    const lateSeconds = Math.max(0, elapsed - patient.golden);
    const rate = 1 - patient.decay * (lateSeconds / 60);
    return Math.round(Math.max(0.15, Math.min(1, rate)) * 100) / 100;
  }

  _updateSuccessRates() {
    for (const patient of this.patients) {
      if (patient.state !== "delivered") patient.successRate = this._successRate(patient);
    }
  }

  _finish() {
    this.finished = true;
    const delivered = this.patients.filter((patient) => patient.state === "delivered").length;
    const usableCar = this.ambulances.some((ambulance) => ambulance.usable && ambulance.fuel > 0 && ambulance.mode !== "stranded");
    const success = delivered >= 4 && usableCar;
    this.result = {
      success,
      delivered,
      target: 4,
      usableCar,
      duration: round1(this.time),
      reason: success
        ? "完成至少四单且保留可用车辆"
        : !usableCar
          ? "无可用车辆"
          : `仅完成 ${delivered} 单`,
    };
    this._record("RESULT", success ? "任务成功" : "任务失败", this.result.reason);
  }

  canDispatch(ambulance, patient) {
    if (ambulance.mode !== "idle" || patient.state !== "waiting" || patient.assignedTo) return false;
    if (ambulance.crew < patient.crewNeed) return false;
    const hospital = this._autoHospital();
    return ambulance.fuel >= this._estimateFuelNeeded(ambulance, patient, hospital);
  }

  exportData() {
    return {
      seed: this.rng.seed,
      roundSeconds: ROUND_SECONDS,
      finishedAt: round1(this.time),
      result: this.result,
      dispatchRecords: this.dispatchRecords,
      patients: this.patients,
      ambulances: this.ambulances.map((ambulance) => ({
        id: ambulance.id,
        name: ambulance.name,
        fuel: round1(ambulance.fuel),
        crew: ambulance.crew,
        status: ambulance.status,
        mode: ambulance.mode,
        usable: ambulance.usable,
        distance: Math.round(ambulance.distance),
        dispatches: ambulance.dispatches,
      })),
      hospitals: this.hospitals,
      logs: this.logs,
    };
  }
}

function pathLength(map, graph, from, to) {
  const path = shortestPath(map, graph, from, to);
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const edge = map.edges.find((item) => edgeKeyOf(item.a, item.b) === edgeKeyOf(path[i], path[i + 1]));
    if (edge) total += edge.length;
  }
  return total;
}

function edgeKeyOf(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
function round1(value) {
  return Math.round(value * 10) / 10;
}
function priorityLabel(priority) {
  return priority === "shortest" ? "最短路径" : "最快避堵";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    GameEngine,
    ROUND_SECONDS,
    BASE_SPEED,
    FUEL_PER_PIXEL,
    REFUEL_RATE,
    LOAD_SECONDS,
    TRAFFIC_LEVELS,
    PATIENT_TEMPLATES,
    AMBULANCE_TEMPLATES,
  };
}
