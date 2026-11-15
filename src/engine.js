(function (root) {
  "use strict";

  const DATA = root.TestShipData;
  const Planner = root.TestShipPlanner;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function easeInOut(value) {
    const t = clamp(value, 0, 1);
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function pointOnPolyline(points, amount) {
    if (points.length === 1) return { ...points[0] };
    const segmentLengths = [];
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      const length = Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].y - points[index - 1].y,
      );
      segmentLengths.push(length);
      total += length;
    }
    let remaining = clamp(amount, 0, 1) * total;
    for (let index = 1; index < points.length; index += 1) {
      const length = segmentLengths[index - 1];
      if (remaining <= length || index === points.length - 1) {
        const ratio = length ? remaining / length : 0;
        return {
          x: lerp(points[index - 1].x, points[index].x, ratio),
          y: lerp(points[index - 1].y, points[index].y, ratio),
        };
      }
      remaining -= length;
    }
    return { ...points[points.length - 1] };
  }

  class MissionEngine {
    constructor(options) {
      this.onUpdate = options.onUpdate || function () {};
      this.onEvent = options.onEvent || function () {};
      this.onComplete = options.onComplete || function () {};
      this.audio = options.audio || null;
      this.speed = 1;
      this.running = false;
      this.complete = false;
      this.plan = null;
      this.route = [];
      this.missionSeconds = 4.5;
      this.shiftIndex = 0;
      this.shiftElapsed = 0;
      this.shiftDuration = 0;
      this.shiftBreak = 0;
      this.operations = [];
      this.cabinStates = {};
      this.robotStates = [];
      this.completedTaskIds = [];
      this.interlockChecks = 0;
      this.pressureAccidents = 0;
      this.archiveMode = false;
      this.lastFrame = null;
      this.frameHandle = 0;
      this.log = null;
      this.lastStates = new Map();
    }

    resetCabinStates() {
      this.cabinStates = {};
      DATA.CABINS.forEach((cabin) => {
        this.cabinStates[cabin.id] = {
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
      this.robotStates = [
        {
          id: "R-01",
          label: "R-01",
          color: DATA.COLORS.amber,
          x: DATA.HUB.dockOne.x,
          y: DATA.HUB.dockOne.y,
          angle: 0,
          active: false,
          taskId: null,
          phaseLabel: "待命 · DOCK",
          progress: 0,
          trail: [],
        },
        {
          id: "R-02",
          label: "R-02",
          color: DATA.COLORS.cyan,
          x: DATA.HUB.dockTwo.x,
          y: DATA.HUB.dockTwo.y,
          angle: 0,
          active: false,
          taskId: null,
          phaseLabel: "待命 · DOCK",
          progress: 0,
          trail: [],
        },
      ];
      this.completedTaskIds = [];
      this.interlockChecks = 0;
      this.pressureAccidents = 0;
      this.lastStates.clear();
    }

    setArchive(sequence) {
      this.stop();
      this.archiveMode = true;
      this.complete = true;
      this.route = [...sequence];
      this.plan = Planner.buildPlan(this.route);
      this.resetCabinStates();
      this.missionSeconds = 11922;
      const finalPressure = {};
      DATA.CABINS.forEach((cabin) => {
        finalPressure[cabin.id] = 1;
        this.cabinStates[cabin.id].complete = true;
      });
      this.plan.entries.forEach((task) => {
        if (task.kind === "vent") finalPressure[task.cabinId] = DATA.LOW_PRESSURE;
      });
      DATA.CABINS.forEach((cabin) => {
        this.cabinStates[cabin.id].pressure = finalPressure[cabin.id];
        this.cabinStates[cabin.id].phaseLabel =
          finalPressure[cabin.id] < 0.5 ? "VACUUM / CERTIFIED" : "NOMINAL / CERTIFIED";
      });
      this.completedTaskIds = [...this.route];
      this.onUpdate(this.getSnapshot(performance.now()));
    }

    start(sequence, speed) {
      const validation = Planner.validateSequence(sequence);
      if (!validation.valid) return validation;
      this.stop();
      this.archiveMode = false;
      this.complete = false;
      this.running = true;
      this.route = [...sequence];
      this.plan = Planner.buildPlan(sequence);
      this.speed = speed || this.speed || 1;
      this.missionSeconds = 4.5;
      this.shiftIndex = 0;
      this.shiftElapsed = 0;
      this.shiftBreak = 0;
      this.log = null;
      this.resetCabinStates();
      this.startShift(0);
      this.lastFrame = null;
      this.emit({
        type: "sortie_start",
        message: "试航开始，两台运输机器人离开中央机库。",
      });
      this.frameHandle = requestAnimationFrame((stamp) => this.loop(stamp));
      return validation;
    }

    stop() {
      this.running = false;
      if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
      this.lastFrame = null;
    }

    setSpeed(speed) {
      this.speed = clamp(Number(speed) || 1, 1, 4);
    }

    loop(stamp) {
      if (!this.running) return;
      if (this.lastFrame === null) this.lastFrame = stamp;
      const realDelta = clamp((stamp - this.lastFrame) / 1000, 0, 0.08);
      this.lastFrame = stamp;
      this.tick(realDelta);
      this.onUpdate(this.getSnapshot(stamp));
      if (this.running) {
        this.frameHandle = requestAnimationFrame((nextStamp) => this.loop(nextStamp));
      }
    }

    tick(realDelta) {
      if (!this.running) return;
      const delta = realDelta * this.speed;
      this.missionSeconds += delta;
      this.shiftElapsed += delta;
      this.evaluateOperations();

      if (this.shiftBreak > 0) {
        this.shiftBreak -= delta;
        if (this.shiftBreak <= 0) {
          this.shiftIndex += 1;
          if (this.shiftIndex < this.plan.shifts.length) {
            this.startShift(this.shiftIndex);
          } else {
            this.finish();
          }
        }
        return;
      }

      if (this.shiftElapsed >= this.shiftDuration) {
        this.shiftBreak = 0.85;
        this.emit({
          type: "shift_complete",
          shift: this.shiftIndex + 1,
          message: `第 ${this.shiftIndex + 1} 班次完成，机器人返回机库。`,
        });
      }
    }

    startShift(shiftIndex) {
      const shift = this.plan.shifts[shiftIndex];
      this.shiftElapsed = 0;
      this.shiftIndex = shiftIndex;
      this.operations = [];

      shift.tasks.forEach((task, slotIndex) => {
        const cabin = DATA.getCabin(task.cabinId);
        const cabinState = this.cabinStates[cabin.id];
        const robot = this.robotStates[slotIndex];
        const basePressure = cabinState.pressure;
        const needsCondition = task.targetPressure > 0.5 && basePressure < 0.5;
        const workingPressure = needsCondition ? 1.0 : basePressure;
        const phases = [];
        let start = 0;
        const addPhase = (name, duration) => {
          phases.push({ name, start, end: start + duration, duration });
          start += duration;
        };
        addPhase("travel", 0.9);
        addPhase("lockIn", 0.35);
        if (needsCondition) addPhase("condition", 1.1);
        addPhase("equalize", 0.95);
        addPhase("hatchIn", 0.45);
        addPhase("enter", 0.4);
        addPhase("work", task.duration);
        addPhase("exit", 0.4);
        if (task.kind === "vent") addPhase("vent", 1.0);
        addPhase("restore", 0.7);
        addPhase("hatchOut", 0.35);
        addPhase("return", 0.8);

        const operation = {
          task,
          cabin,
          cabinState,
          robot,
          robotIndex: slotIndex,
          basePressure,
          workingPressure,
          needsCondition,
          dockPoint: { x: robot.x, y: robot.y },
          phases,
          startAt: slotIndex * 0.1,
          total: start,
          lastPhase: "",
          fired: new Set(),
          done: false,
        };
        this.operations.push(operation);
        robot.active = true;
        robot.taskId = task.id;
        robot.phaseLabel = "前往气闸";
        robot.progress = 0;
        robot.trail = [{ x: robot.x, y: robot.y }];
        cabinState.active = true;
        cabinState.complete = false;
      });

      this.shiftDuration = Math.max(...this.operations.map((op) => op.total)) + 0.55;
      this.emit({
        type: "shift_start",
        shift: shift.number,
        priorityTask: shift.priorityTask,
        message: shift.priorityTask
          ? `第 ${shift.number} 班次开始，${shift.priorityTask} 高优先样本占用 1 个机位。`
          : `第 ${shift.number} 班次开始，两台机器人并行执行。`,
      });
      this.onUpdate(this.getSnapshot(performance.now()));
    }

    operationPhase(operation, elapsed) {
      if (elapsed < 0) return { name: "wait", progress: 0 };
      if (elapsed >= operation.total) return { name: "done", progress: 1 };
      const phase = operation.phases.find((item) => elapsed < item.end);
      return {
        name: phase.name,
        progress: phase.duration ? clamp((elapsed - phase.start) / phase.duration, 0, 1) : 1,
      };
    }

    evaluateOperations() {
      this.operations.forEach((operation) => {
        const elapsed = this.shiftElapsed - operation.startAt;
        const phase = this.operationPhase(operation, elapsed);
        if (phase.name !== operation.lastPhase) {
          if (phase.name !== "done" && phase.name !== "wait") {
            this.onPhaseStart(operation, phase);
          }
          operation.lastPhase = phase.name;
        }
        if (phase.name === "done") {
          if (!operation.done) this.completeOperation(operation);
          return;
        }
        if (phase.name !== "wait") this.applyOperationVisuals(operation, phase);
      });
    }

    onPhaseStart(operation, phase) {
      const task = operation.task;
      const cabin = operation.cabin;
      const cabinState = operation.cabinState;
      cabinState.phaseLabel = this.phaseLabel(phase.name, task);
      operation.robot.phaseLabel = cabinState.phaseLabel;

      if (phase.name === "lockIn" && !operation.fired.has("outer_in")) {
        operation.fired.add("outer_in");
        this.checkInterlock(operation, "outer", cabinState.lockPressure, 1);
      }
      if (phase.name === "condition" && !operation.fired.has("condition")) {
        operation.fired.add("condition");
        this.emit({
          type: "cabin_repressurize",
          cabin: cabin.code,
          task: task.id,
          message: `${cabin.code} 舱预增压至 1.00 bar，内舱门保持闭锁。`,
        });
        if (this.audio) this.audio.valve(1.0, 0.4);
      }
      if (phase.name === "equalize" && !operation.fired.has("equalize")) {
        operation.fired.add("equalize");
        cabinState.equalizing = true;
        this.emit({
          type: "equalize",
          cabin: cabin.code,
          task: task.id,
          message: `${cabin.code} 气闸平衡至 ${operation.workingPressure.toFixed(2)} bar。`,
        });
        if (this.audio) this.audio.valve(0.9, operation.workingPressure);
      }
      if (phase.name === "hatchIn" && !operation.fired.has("inner_in")) {
        operation.fired.add("inner_in");
        cabinState.equalizing = false;
        cabinState.lockPressure = operation.workingPressure;
        this.checkInterlock(operation, "inner", cabinState.lockPressure, cabinState.pressure);
        if (this.audio) this.audio.hatch();
      }
      if (phase.name === "work" && !operation.fired.has("work")) {
        operation.fired.add("work");
        this.emit({
          type: "work_start",
          cabin: cabin.code,
          task: task.id,
          robot: operation.robot.id,
          message: `${operation.robot.id} 在 ${cabin.code} 舱执行 ${task.title}。`,
        });
        if (this.audio) {
          this.audio.motor(task.duration + 0.35, task.kind === "vent" ? 1.15 : 0.8);
        }
      }
      if (phase.name === "vent" && !operation.fired.has("vent")) {
        operation.fired.add("vent");
        this.emit({
          type: "vent",
          cabin: cabin.code,
          task: task.id,
          target: DATA.LOW_PRESSURE,
          message: `${cabin.code} 舱隔离完成，开始抽气至 ${DATA.LOW_PRESSURE.toFixed(2)} bar。`,
        });
        if (this.audio) this.audio.valve(1.15, 0.15);
      }
      if (phase.name === "hatchOut" && !operation.fired.has("outer_out")) {
        operation.fired.add("outer_out");
        cabinState.lockPressure = 1;
        this.checkInterlock(operation, "outer", cabinState.lockPressure, 1);
        if (this.audio) this.audio.hatch();
      }
    }

    applyOperationVisuals(operation, phase) {
      const cabin = operation.cabin;
      const cabinState = operation.cabinState;
      const robot = operation.robot;
      const lock = cabin.lock;
      const lockCenter = { x: lock.x + lock.w / 2, y: lock.y + lock.h / 2 };
      const outer = lock.outer;
      const inner = lock.inner;
      const work = cabin.workPoint;
      const dockPoint = operation.dockPoint;
      const postPressure =
        operation.task.kind === "vent" ? DATA.LOW_PRESSURE : operation.workingPressure;
      const approach = [
        dockPoint,
        ...DATA.CORRIDOR_PATHS[cabin.id],
        lock.outer,
      ];
      let target = { x: robot.x, y: robot.y };

      cabinState.lockPressure = 1;
      cabinState.innerOpen = 0;
      cabinState.outerOpen = 0;
      cabinState.equalizing = false;

      if (phase.name === "travel") {
        const eased = easeInOut(phase.progress);
        target = pointOnPolyline(approach, eased);
        cabinState.pressure = operation.basePressure;
      } else if (phase.name === "lockIn") {
        target = {
          x: lerp(outer.x, lockCenter.x, easeInOut(phase.progress)),
          y: lerp(outer.y, lockCenter.y, easeInOut(phase.progress)),
        };
        cabinState.outerOpen = phase.progress;
        cabinState.pressure = operation.basePressure;
      } else if (phase.name === "condition") {
        target = lockCenter;
        cabinState.pressure = lerp(operation.basePressure, 1, easeInOut(phase.progress));
      } else if (phase.name === "equalize") {
        target = lockCenter;
        cabinState.equalizing = true;
        cabinState.lockPressure = lerp(1, operation.workingPressure, easeInOut(phase.progress));
        cabinState.pressure = operation.workingPressure;
      } else if (phase.name === "hatchIn") {
        target = lockCenter;
        cabinState.lockPressure = operation.workingPressure;
        cabinState.pressure = operation.workingPressure;
        cabinState.innerOpen = phase.progress;
      } else if (phase.name === "enter") {
        const path = [lockCenter, inner, work];
        target = pointOnPolyline(path, easeInOut(phase.progress));
        cabinState.lockPressure = operation.workingPressure;
        cabinState.pressure = operation.workingPressure;
        cabinState.innerOpen = 1;
      } else if (phase.name === "work") {
        target = work;
        cabinState.lockPressure = operation.workingPressure;
        cabinState.pressure = operation.workingPressure;
        cabinState.innerOpen = 1;
      } else if (phase.name === "exit") {
        const path = [work, inner, lockCenter];
        target = pointOnPolyline(path, easeInOut(phase.progress));
        cabinState.lockPressure = operation.workingPressure;
        cabinState.pressure = operation.workingPressure;
        cabinState.innerOpen = 1 - phase.progress;
      } else if (phase.name === "vent") {
        target = lockCenter;
        cabinState.lockPressure = operation.workingPressure;
        cabinState.pressure = lerp(
          operation.workingPressure,
          DATA.LOW_PRESSURE,
          easeInOut(phase.progress),
        );
      } else if (phase.name === "restore") {
        target = lockCenter;
        cabinState.pressure = postPressure;
        cabinState.lockPressure = lerp(
          operation.workingPressure,
          1,
          easeInOut(phase.progress),
        );
      } else if (phase.name === "hatchOut") {
        target = {
          x: lerp(lockCenter.x, outer.x, easeInOut(phase.progress)),
          y: lerp(lockCenter.y, outer.y, easeInOut(phase.progress)),
        };
        cabinState.pressure = postPressure;
        cabinState.lockPressure = 1;
        cabinState.outerOpen = phase.progress;
      } else if (phase.name === "return") {
        const reverse = [...approach].reverse();
        target = pointOnPolyline(reverse, easeInOut(phase.progress));
        cabinState.pressure = postPressure;
        cabinState.lockPressure = 1;
        cabinState.outerOpen = 1 - phase.progress;
      }

      const dx = target.x - robot.x;
      const dy = target.y - robot.y;
      if (Math.hypot(dx, dy) > 0.2) robot.angle = Math.atan2(dy, dx);
      robot.x = target.x;
      robot.y = target.y;
      robot.progress = phase.progress;
      const last = robot.trail[robot.trail.length - 1];
      if (!last || Math.hypot(target.x - last.x, target.y - last.y) > 1.1) {
        robot.trail.push({ x: target.x, y: target.y });
        if (robot.trail.length > 52) robot.trail.shift();
      }
    }

    completeOperation(operation) {
      if (operation.done) return;
      operation.done = true;
      const cabinState = operation.cabinState;
      const robot = operation.robot;
      cabinState.pressure = operation.task.targetPressure;
      cabinState.lockPressure = 1;
      cabinState.innerOpen = 0;
      cabinState.outerOpen = 0;
      cabinState.equalizing = false;
      cabinState.active = false;
      cabinState.complete = true;
      cabinState.phaseLabel =
        operation.task.kind === "vent" ? "VACUUM / CERTIFIED" : "NOMINAL / CERTIFIED";
      robot.active = false;
      robot.taskId = null;
      robot.phaseLabel = "待命 · DOCK";
      robot.progress = 0;
      robot.x = operation.robotIndex === 0 ? DATA.HUB.dockOne.x : DATA.HUB.dockTwo.x;
      robot.y = operation.robotIndex === 0 ? DATA.HUB.dockOne.y : DATA.HUB.dockTwo.y;
      robot.angle = operation.robotIndex === 0 ? 0 : Math.PI;
      if (!this.completedTaskIds.includes(operation.task.id)) {
        this.completedTaskIds.push(operation.task.id);
      }
      this.emit({
        type: "task_complete",
        cabin: operation.cabin.code,
        task: operation.task.id,
        robot: robot.id,
        pressure: operation.task.targetPressure,
        message: `${operation.task.id} ${operation.task.title} 完成，${robot.id} 返回中央机库。`,
      });
    }

    checkInterlock(operation, door, pressureA, pressureB) {
      this.interlockChecks += 1;
      const delta = Math.abs(pressureA - pressureB);
      const passed = delta <= DATA.BALANCE_TOLERANCE;
      if (!passed) {
        this.pressureAccidents += 1;
        this.emit({
          type: "pressure_alarm",
          cabin: operation.cabin.code,
          task: operation.task.id,
          door,
          delta,
          message: `压力事故：${operation.cabin.code} ${door} 舱门在 Δ${delta.toFixed(3)} bar 时开启。`,
        });
        return;
      }
      const doorLabel = door === "inner" ? "内舱门" : "外舱门";
      this.emit({
        type: "interlock_pass",
        cabin: operation.cabin.code,
        task: operation.task.id,
        door,
        delta,
        message: `${operation.cabin.code} ${doorLabel}联锁通过 · Δ${delta.toFixed(3)} bar。`,
      });
    }

    emit(event) {
      const record = {
        ...event,
        at: Number(this.missionSeconds.toFixed(2)),
        stamp: Planner.formatStamp(this.missionSeconds),
      };
      this.onEvent(record);
    }

    phaseLabel(phase, task) {
      const labels = {
        travel: "前往气闸",
        lockIn: "外舱门联锁",
        condition: "舱室预增压",
        equalize: "压力平衡中",
        hatchIn: "内舱门联锁",
        enter: "进入舱室",
        work: `${task.kindLabel}作业中`,
        exit: "撤回气闸",
        vent: "抽气泄压中",
        restore: "气闸复压中",
        hatchOut: "外舱门联锁",
        return: "返回机库",
      };
      return labels[phase] || phase;
    }

    getSnapshot(stamp) {
      const cabins = {};
      DATA.CABINS.forEach((cabin) => {
        const state = this.cabinStates[cabin.id];
        cabins[cabin.id] = {
          pressure: state.pressure,
          lockPressure: state.lockPressure,
          innerOpen: state.innerOpen,
          outerOpen: state.outerOpen,
          equalizing: state.equalizing,
          active: state.active,
          complete: state.complete,
          phaseLabel: state.phaseLabel,
        };
      });
      const activeCabinIds = this.operations
        .filter((operation) => !operation.done && operation.lastPhase !== "wait")
        .map((operation) => operation.cabin.id);
      const completedCabinIds = this.complete
        ? DATA.CABINS.map((cabin) => cabin.id)
        : Array.from(
            new Set(
              this.operations
                .filter((operation) => operation.done)
                .map((operation) => operation.cabin.id),
            ),
          );
      return {
        stamp: stamp || performance.now(),
        running: this.running,
        complete: this.complete,
        archiveMode: this.archiveMode,
        missionSeconds: this.missionSeconds,
        shift: this.shiftIndex + 1,
        cabins,
        robots: this.robotStates.map((robot) => ({
          id: robot.id,
          label: robot.label,
          color: robot.color,
          x: robot.x,
          y: robot.y,
          angle: robot.angle,
          active: robot.active,
          taskId: robot.taskId,
          phaseLabel: robot.phaseLabel,
          progress: robot.progress,
          trail: robot.trail.map((point) => ({ x: point.x, y: point.y })),
        })),
        activeCabinIds: Array.from(new Set(activeCabinIds)),
        completedCabinIds,
        activeTaskIds: this.operations.filter((operation) => !operation.done).map(
          (operation) => operation.task.id,
        ),
        pressureAccidents: this.pressureAccidents,
        interlockChecks: this.interlockChecks,
        completedTasks: this.completedTaskIds.length,
        completedTaskIds: [...this.completedTaskIds],
        totalTasks: DATA.TASKS.length,
        showAllRoutes: this.complete,
      };
    }

    finish() {
      if (this.complete) return;
      this.emit({
        type: "sortie_complete",
        message: "六项舱内作业完成；全部气闸联锁有效，试航通过。",
      });
      this.running = false;
      this.complete = true;
      this.archiveMode = false;
      this.operations.forEach((operation) => {
        operation.done = true;
        operation.cabinState.pressure = operation.task.targetPressure;
        operation.cabinState.lockPressure = 1;
        operation.cabinState.innerOpen = 0;
        operation.cabinState.outerOpen = 0;
        operation.cabinState.active = false;
        operation.cabinState.complete = true;
        operation.cabinState.equalizing = false;
        operation.robot.active = false;
      });
      this.robotStates.forEach((robot, index) => {
        const dock = index === 0 ? DATA.HUB.dockOne : DATA.HUB.dockTwo;
        robot.x = dock.x;
        robot.y = dock.y;
        robot.angle = index === 0 ? 0 : Math.PI;
      });
      this.completedTaskIds = [...this.route];
      this.log = Planner.buildMissionLog(this.route, {
        completedAt: new Date().toISOString(),
      });
      if (this.audio) this.audio.complete();
      this.onUpdate(this.getSnapshot(performance.now()));
      this.onComplete(this.log);
    }
  }

  root.MissionEngine = MissionEngine;
})(typeof globalThis !== "undefined" ? globalThis : this);
