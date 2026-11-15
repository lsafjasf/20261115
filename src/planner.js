(function (root) {
  "use strict";

  const DATA = root.TestShipData || (typeof require !== "undefined" ? require("./data.js") : null);

  function validateSequence(sequence) {
    const errors = [];
    if (!Array.isArray(sequence)) {
      return { valid: false, errors: ["任务顺序必须是数组。"] };
    }
    if (sequence.length !== DATA.TASKS.length) {
      errors.push(`需要编排 ${DATA.TASKS.length} 项作业，当前为 ${sequence.length} 项。`);
    }
    const unique = new Set(sequence);
    if (unique.size !== sequence.length) {
      errors.push("同一项作业不能重复编排。");
    }
    DATA.TASKS.forEach((task) => {
      if (!unique.has(task.id)) errors.push(`缺少作业 ${task.id}。`);
    });
    sequence.forEach((id) => {
      if (!DATA.getTask(id)) errors.push(`未知作业 ${id}。`);
    });
    for (let index = 0; index < sequence.length; index += 2) {
      const first = DATA.getTask(sequence[index]);
      const second = DATA.getTask(sequence[index + 1]);
      if (first && second && first.cabinId === second.cabinId) {
        errors.push(
          `第 ${index / 2 + 1} 班次的两项作业都占用 ${DATA.getCabin(first.cabinId).code} 舱气闸，请拆到不同班次。`,
        );
      }
    }
    return { valid: errors.length === 0, errors };
  }

  function buildPlan(sequence) {
    const validation = validateSequence(sequence);
    if (!validation.valid) {
      return { validation, shifts: [], entries: [] };
    }

    const entries = sequence.map((id, index) => {
      const task = DATA.getTask(id);
      return {
        ...task,
        sequence: index + 1,
        shiftIndex: Math.floor(index / 2),
        slot: index % 2,
        cabin: DATA.getCabin(task.cabinId),
      };
    });

    const shifts = [];
    for (let index = 0; index < entries.length; index += 2) {
      const tasks = entries.slice(index, index + 2);
      const shiftIndex = Math.floor(index / 2);
      const priorityTask = tasks.find((task) => task.priority === "express");
      shifts.push({
        index: shiftIndex,
        number: shiftIndex + 1,
        tasks,
        priorityTask: priorityTask ? priorityTask.id : null,
        priorityLock: priorityTask ? 1 : 0,
        starvationPromotions: tasks
          .filter((task) => shiftIndex >= 2 && task.priority !== "express")
          .map((task) => task.id),
      });
    }

    return { validation, shifts, entries };
  }

  function pad(value, length) {
    return String(value).padStart(length, "0");
  }

  function formatStamp(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    return `T+${pad(Math.floor(whole / 3600), 2)}:${pad(Math.floor((whole % 3600) / 60), 2)}:${pad(whole % 60, 2)}`;
  }

  function buildMissionLog(sequence, options) {
    const opts = options || {};
    const plan = buildPlan(sequence);
    const finalPressure = {};
    DATA.CABINS.forEach((cabin) => {
      finalPressure[cabin.id] = cabin.pressure;
    });

    const events = [];
    const shiftRecords = [];
    let interlocksPassed = 0;
    let pressureEvents = 0;
    let missionSeconds = 4.5;
    const shiftGap = 1.2;

    plan.shifts.forEach((shift) => {
      const shiftStart = missionSeconds;
      const shiftTasks = [];
      shift.tasks.forEach((task, slotIndex) => {
        const cabin = task.cabin;
        const initialPressure = finalPressure[cabin.id];
        const requiresConditioning = task.targetPressure > 0.5 && initialPressure < 0.5;
        const taskStart = shiftStart + slotIndex * 0.12;
        const robotId = slotIndex === 0 ? "R-01" : "R-02";
        const equalizeAt = taskStart + 0.85 + (requiresConditioning ? 1.0 : 0);
        const hatchAt = equalizeAt + 0.95;
        const workAt = hatchAt + 0.7;
        const ventAt = workAt + task.duration + 0.55;
        const doneAt = task.kind === "vent" ? ventAt + 1.1 : workAt + task.duration + 0.8;

        if (requiresConditioning) {
          pressureEvents += 1;
          events.push({
            at: taskStart + 0.8,
            type: "cabin_repressurize",
            cabin: cabin.code,
            task: task.id,
            message: `${cabin.code} 舱预增压至 1.00 bar，内舱门保持闭锁。`,
          });
          finalPressure[cabin.id] = 1.0;
        }

        events.push({
          at: taskStart + 0.82,
          type: "hatch_outer_in",
          cabin: cabin.code,
          task: task.id,
          delta: 0,
          message: `${cabin.code} 外舱门入舱联锁通过 · Δ0.000 bar。`,
        });
        interlocksPassed += 1;

        events.push({
          at: equalizeAt,
          type: "equalize",
          cabin: cabin.code,
          task: task.id,
          delta: 0,
          message: `${cabin.code} 气闸平衡至 ${task.targetPressure.toFixed(2)} bar。`,
        });
        pressureEvents += 1;

        events.push({
          at: hatchAt,
          type: "hatch_inner",
          cabin: cabin.code,
          task: task.id,
          delta: 0,
          message: `${cabin.code} 内舱门联锁通过 · Δ0.000 bar。`,
        });
        interlocksPassed += 1;

        events.push({
          at: workAt,
          type: "work_start",
          cabin: cabin.code,
          task: task.id,
          robot: robotId,
          message: `${robotId} 在 ${cabin.code} 舱执行 ${task.title}。`,
        });

        if (task.kind === "vent") {
          events.push({
            at: ventAt,
            type: "vent",
            cabin: cabin.code,
            task: task.id,
            target: DATA.LOW_PRESSURE,
            message: `${cabin.code} 舱隔离完成，开始抽气至 ${DATA.LOW_PRESSURE.toFixed(2)} bar。`,
          });
          pressureEvents += 1;
          finalPressure[cabin.id] = DATA.LOW_PRESSURE;
        } else {
          finalPressure[cabin.id] = 1.0;
        }

        events.push({
          at: doneAt - 0.45,
          type: "hatch_outer",
          cabin: cabin.code,
          task: task.id,
          delta: 0,
          message: `${cabin.code} 外舱门联锁通过 · Δ0.000 bar。`,
        });
        interlocksPassed += 1;

        events.push({
          at: doneAt,
          type: "task_complete",
          cabin: cabin.code,
          task: task.id,
          robot: robotId,
          pressure: finalPressure[cabin.id],
          message: `${task.id} ${task.title} 完成，${robotId} 返回中央机库。`,
        });

        shiftTasks.push({
          id: task.id,
          title: task.title,
          kind: task.kind,
          cabin: cabin.code,
          robot: robotId,
          slot: slotIndex + 1,
          startedAt: Number(taskStart.toFixed(2)),
          completedAt: Number(doneAt.toFixed(2)),
          initialPressure,
          finalPressure: finalPressure[cabin.id],
          hatchInterlocks: 3,
        });
      });

      const shiftEnd = Math.max(...shiftTasks.map((task) => task.completedAt)) + 0.6;
      shiftRecords.push({
        shift: shift.number,
        start: Number(shiftStart.toFixed(2)),
        end: Number(shiftEnd.toFixed(2)),
        tasks: shiftTasks,
        priorityLock: shift.priorityLock,
        priorityTask: shift.priorityTask,
        starvationPromotions: shift.starvationPromotions,
      });
      missionSeconds = shiftEnd + shiftGap;
    });

    events.sort((a, b) => a.at - b.at);
    const starvationGuards = plan.entries
      .filter((task) => task.shiftIndex >= 2)
      .map((task) => ({
        task: task.id,
        waitedShifts: task.shiftIndex,
        promotedAtShift: task.shiftIndex + 1,
        resolved: true,
      }));

    const finalCabins = DATA.CABINS.map((cabin) => ({
      id: cabin.id,
      code: cabin.code,
      name: cabin.name,
      pressure: Number(finalPressure[cabin.id].toFixed(2)),
      status: finalPressure[cabin.id] < 0.5 ? "depressurized" : "nominal",
    }));

    const completed = plan.entries.length === DATA.TASKS.length;
    const success = completed && interlocksPassed === DATA.TASKS.length * 3;

    return {
      schema: "t09.airlock-sortie/1",
      mission: {
        id: opts.id || "SRT-004",
        vessel: "T-09",
        title: "四舱气密试航",
        completedAt: opts.completedAt || "2026-11-15T01:18:42.000Z",
        durationSeconds: Number((missionSeconds - shiftGap).toFixed(1)),
        success,
      },
      taskOrder: plan.entries.map((task) => ({
        sequence: task.sequence,
        shift: task.shiftIndex + 1,
        slot: task.slot + 1,
        id: task.id,
        cabin: task.cabin.code,
        kind: task.kind,
        title: task.title,
        priority: task.priority,
        targetPressure: task.targetPressure,
        waitShifts: task.shiftIndex,
      })),
      shifts: shiftRecords,
      pressure: {
        initial: DATA.CABINS.map((cabin) => ({
          id: cabin.id,
          code: cabin.code,
          pressure: cabin.pressure,
        })),
        final: finalCabins,
        equalizationEvents: pressureEvents,
        accidents: 0,
        interlockChecks: interlocksPassed,
        interlockPassed: interlocksPassed,
      },
      scheduling: {
        priorityRule: "高优先级样本占用其执行班次 1 个机位；普通作业等待 2 班后强制提升。",
        priorityReservations: plan.shifts
          .filter((shift) => shift.priorityTask)
          .map((shift) => ({
            shift: shift.number,
            task: shift.priorityTask,
            slots: shift.priorityLock,
          })),
        starvationGuards,
        starvationViolations: 0,
      },
      events: events.map((event) => ({
        ...event,
        at: Number(event.at.toFixed(2)),
        stamp: formatStamp(event.at),
      })),
      result: {
        completedTasks: plan.entries.length,
        totalTasks: DATA.TASKS.length,
        pressureAccidents: 0,
        shiftsUsed: shiftRecords.length,
        verdict: success ? "CERTIFIED" : "INCOMPLETE",
      },
    };
  }

  const API = {
    validateSequence,
    buildPlan,
    buildMissionLog,
    formatStamp,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  } else {
    root.TestShipPlanner = API;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
