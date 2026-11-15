(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DispatchEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONFIG = Object.freeze({
    stationName: "青川站",
    sectionName: "青川—岭口 单线区段",
    windowStart: 7 * 60 + 50,
    windowEnd: 9 * 60 + 40,
    sectionMinutes: 4,
    minHeadway: 3,
    switchMinutes: 2,
    minSwitchGap: 1,
    minTurnaround: 12,
    tightTurnaround: 15,
    maxTrains: 9,
    tracks: Object.freeze([
      { id: "1", name: "1道" },
      { id: "2", name: "2道" },
    ]),
  });

  const PALETTE = [
    "#2678d2",
    "#0f9d8f",
    "#c87522",
    "#7457c8",
    "#2d8f55",
    "#bd506f",
    "#4f708e",
    "#8c6c26",
    "#3c8fc3",
  ];

  const DEFAULT_TRAINS = Object.freeze([
    { id: "t1", number: "G101", track: "1", arrival: "08:00", departure: "08:16", kind: "动车组", color: PALETTE[0] },
    { id: "t2", number: "D602", track: "2", arrival: "08:08", departure: "08:24", kind: "动车组", color: PALETTE[1] },
    { id: "t3", number: "K703", track: "1", arrival: "08:32", departure: "08:48", kind: "普速", color: PALETTE[2] },
    { id: "t4", number: "G104", track: "2", arrival: "08:40", departure: "08:56", kind: "动车组", color: PALETTE[3] },
    { id: "t5", number: "D605", track: "1", arrival: "09:04", departure: "09:20", kind: "动车组", color: PALETTE[4] },
    { id: "t6", number: "K706", track: "2", arrival: "09:12", departure: "09:28", kind: "普速", color: PALETTE[5] },
  ]);

  function cloneDefaultTrains() {
    return DEFAULT_TRAINS.map(function (train) {
      return Object.assign({}, train);
    });
  }

  function parseTime(value) {
    if (typeof value !== "string") return null;
    const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function formatTime(totalMinutes) {
    if (!Number.isFinite(totalMinutes)) return "--:--";
    const rounded = Math.round(totalMinutes);
    const minutes = ((rounded % 1440) + 1440) % 1440;
    return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
  }

  function formatDuration(minutes) {
    if (!Number.isFinite(minutes)) return "--";
    const sign = minutes < 0 ? "−" : "";
    const value = Math.abs(Math.round(minutes));
    return sign + value;
  }

  function clipInterval(start, end, from, to) {
    const clippedStart = Math.max(start, from);
    const clippedEnd = Math.min(end, to);
    return { start: clippedStart, end: clippedEnd, minutes: Math.max(0, clippedEnd - clippedStart) };
  }

  function unionMinutes(intervals) {
    if (!intervals.length) return 0;
    const sorted = intervals
      .map(function (item) { return { start: Math.max(item.start, CONFIG.windowStart), end: Math.min(item.end, CONFIG.windowEnd) }; })
      .filter(function (item) { return item.end > item.start; })
      .sort(function (a, b) { return a.start - b.start; });
    if (!sorted.length) return 0;
    let total = 0;
    let start = sorted[0].start;
    let end = sorted[0].end;
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].start <= end) {
        end = Math.max(end, sorted[i].end);
      } else {
        total += end - start;
        start = sorted[i].start;
        end = sorted[i].end;
      }
    }
    return total + end - start;
  }

  function makeTrainMap(trains) {
    const map = new Map();
    trains.forEach(function (train) { map.set(train.id, train); });
    return map;
  }

  function numberLabel(train) {
    return (train && train.number ? train.number : "未命名").trim() || "未命名";
  }

  function addOccupancy(list, data) {
    list.push(Object.assign({
      id: "occ-" + list.length + 1,
    }, data));
  }

  function buildOccupancies(modelTrains) {
    const occupancies = [];
    const sectionHalf = CONFIG.sectionMinutes / 2;
    const switchHalf = CONFIG.switchMinutes / 2;

    modelTrains.forEach(function (train) {
      const base = {
        trainId: train.id,
        trainNumber: train.number,
        color: train.color,
        track: train.track,
      };

      if (train.arrivalMin !== null) {
        addOccupancy(occupancies, Object.assign({}, base, {
          kind: "section",
          event: "arrival",
          label: train.number + " 到达",
          start: train.arrivalMin - sectionHalf,
          end: train.arrivalMin + sectionHalf,
          anchor: train.arrivalMin,
        }));
        addOccupancy(occupancies, Object.assign({}, base, {
          kind: "switch",
          event: "arrival",
          label: train.number + " 接车进路",
          start: train.arrivalMin - switchHalf,
          end: train.arrivalMin + switchHalf,
          anchor: train.arrivalMin,
        }));
      }

      if (train.departureMin !== null) {
        addOccupancy(occupancies, Object.assign({}, base, {
          kind: "section",
          event: "departure",
          label: train.number + " 发车",
          start: train.departureMin - sectionHalf,
          end: train.departureMin + sectionHalf,
          anchor: train.departureMin,
        }));
        addOccupancy(occupancies, Object.assign({}, base, {
          kind: "switch",
          event: "departure",
          label: train.number + " 发车进路",
          start: train.departureMin - switchHalf,
          end: train.departureMin + switchHalf,
          anchor: train.departureMin,
        }));
      }

      if (train.arrivalMin !== null && train.departureMin !== null && train.departureMin >= train.arrivalMin) {
        addOccupancy(occupancies, Object.assign({}, base, {
          kind: "track",
          event: "dwell",
          resource: train.track,
          label: train.number + " 停站",
          start: train.arrivalMin,
          end: train.departureMin,
          anchor: train.arrivalMin,
        }));
      }
    });

    return occupancies;
  }

  function conflictSeverityRank(severity) {
    return severity === "severe" ? 0 : 1;
  }

  function buildConflict(data) {
    return Object.assign({
      severity: "severe",
      title: "运行冲突",
      detail: "",
      time: null,
      trainIds: [],
    }, data);
  }

  function checkSectionHeadway(occupancies, conflicts) {
    const items = occupancies
      .filter(function (item) { return item.kind === "section"; })
      .sort(function (a, b) { return a.start - b.start || a.end - b.end; });

    for (let i = 1; i < items.length; i += 1) {
      const previous = items[i - 1];
      const current = items[i];
      const gap = current.start - previous.end;
      if (gap >= CONFIG.minHeadway) continue;
      const overlap = Math.max(0, -gap);
      conflicts.push(buildConflict({
        kind: "tracking",
        severity: "severe",
        title: overlap > 0 ? "单线区段占用重叠" : "追踪间隔不足",
        detail: previous.trainNumber + " 与 " + current.trainNumber + " 的区间占用" +
          (overlap > 0 ? "重叠 " + overlap + " min" : "仅间隔 " + gap + " min") +
          "，要求 ≥ " + CONFIG.minHeadway + " min。",
        time: overlap > 0 ? previous.end - overlap / 2 : current.start,
        trainIds: [previous.trainId, current.trainId],
        resource: "section",
      }));
    }
  }

  function checkSwitchOccupancy(occupancies, conflicts) {
    const items = occupancies
      .filter(function (item) { return item.kind === "switch"; })
      .sort(function (a, b) { return a.start - b.start || a.end - b.end; });

    for (let i = 1; i < items.length; i += 1) {
      const previous = items[i - 1];
      const current = items[i];
      const gap = current.start - previous.end;
      if (gap < 0) {
        conflicts.push(buildConflict({
          kind: "switch",
          severity: "severe",
          title: "道岔锁闭重叠",
          detail: previous.trainNumber + " 与 " + current.trainNumber + " 同时占用咽喉道岔，重叠 " +
            Math.abs(gap) + " min，进路不能同时建立。",
          time: Math.max(previous.start, current.start),
          trainIds: [previous.trainId, current.trainId],
          resource: "switch",
        }));
      } else if (gap < CONFIG.minSwitchGap) {
        conflicts.push(buildConflict({
          kind: "switch",
          severity: "warning",
          title: "道岔动作余量偏紧",
          detail: previous.trainNumber + " 与 " + current.trainNumber + " 的锁闭间隔不足 " +
            CONFIG.minSwitchGap + " min，建议错开进路。",
          time: previous.end,
          trainIds: [previous.trainId, current.trainId],
          resource: "switch",
        }));
      }
    }
  }

  function checkTrackConflicts(occupancies, conflicts) {
    CONFIG.tracks.forEach(function (track) {
      const items = occupancies
        .filter(function (item) { return item.kind === "track" && item.resource === track.id; })
        .sort(function (a, b) { return a.start - b.start || a.end - b.end; });

      for (let i = 1; i < items.length; i += 1) {
        const previous = items[i - 1];
        const current = items[i];
        if (current.start < previous.end) {
          const overlap = previous.end - current.start;
          conflicts.push(buildConflict({
            kind: "track",
            severity: "severe",
            title: track.name + "占用重叠",
            detail: previous.trainNumber + " 与 " + current.trainNumber + " 在 " + track.name +
              " 同时停留，重叠 " + overlap + " min。",
            time: current.start,
            trainIds: [previous.trainId, current.trainId],
            resource: "track-" + track.id,
          }));
        }
      }
    });
  }

  function checkTrainRules(modelTrains, conflicts) {
    const numberGroups = new Map();
    modelTrains.forEach(function (train) {
      const key = train.number.trim().toLowerCase();
      if (!numberGroups.has(key)) numberGroups.set(key, []);
      numberGroups.get(key).push(train);
    });

    numberGroups.forEach(function (group) {
      if (group.length < 2) return;
      conflicts.push(buildConflict({
        kind: "duplicate",
        title: "车次重复",
        detail: "车次 " + group[0].number + " 出现了 " + group.length + " 次，请为列车设置唯一车次。",
        time: null,
        trainIds: group.map(function (train) { return train.id; }),
        resource: "identity",
      }));
    });

    modelTrains.forEach(function (train) {
      if (train.arrivalMin === null || train.departureMin === null) {
        conflicts.push(buildConflict({
          kind: "input",
          title: "时刻格式无效",
          detail: train.number + " 的到达或发车时刻为空或格式不正确。",
          trainIds: [train.id],
          resource: "identity",
        }));
        return;
      }

      const dwell = train.departureMin - train.arrivalMin;
      if (dwell < 0) {
        conflicts.push(buildConflict({
          kind: "turnaround",
          title: "发车早于到达",
          detail: train.number + " 的发车时刻早于到达时刻，无法形成折返。",
          time: train.arrivalMin,
          trainIds: [train.id],
          resource: "track-" + train.track,
        }));
      } else if (dwell < CONFIG.minTurnaround) {
        conflicts.push(buildConflict({
          kind: "turnaround",
          title: "折返时间不足",
          detail: train.number + " 仅停留 " + dwell + " min，低于最小折返 " +
            CONFIG.minTurnaround + " min。",
          time: train.arrivalMin + Math.max(0, dwell) / 2,
          trainIds: [train.id],
          resource: "track-" + train.track,
        }));
      } else if (dwell < CONFIG.tightTurnaround) {
        conflicts.push(buildConflict({
          kind: "turnaround",
          severity: "warning",
          title: "折返余量偏紧",
          detail: train.number + " 停留 " + dwell + " min，满足最低要求，但低于建议的 " +
            CONFIG.tightTurnaround + " min。",
          time: train.arrivalMin + dwell / 2,
          trainIds: [train.id],
          resource: "track-" + train.track,
        }));
      }

      [train.arrivalMin, train.departureMin].forEach(function (eventTime) {
        if (eventTime < CONFIG.windowStart || eventTime > CONFIG.windowEnd) {
          conflicts.push(buildConflict({
            kind: "window",
            severity: "warning",
            title: "超出计划窗口",
            detail: train.number + " 的作业时刻超出 07:50—09:40 计划窗口，图中会被裁切。",
            time: eventTime,
            trainIds: [train.id],
            resource: "window",
          }));
        }
      });
    });
  }

  function calculatePeakTracks(occupancies) {
    const points = [];
    occupancies
      .filter(function (item) { return item.kind === "track"; })
      .forEach(function (item) {
        const clipped = clipInterval(item.start, item.end, CONFIG.windowStart, CONFIG.windowEnd);
        if (clipped.minutes <= 0) return;
        points.push({ time: clipped.start, delta: 1 });
        points.push({ time: clipped.end, delta: -1 });
      });
    points.sort(function (a, b) { return a.time - b.time || a.delta - b.delta; });
    let current = 0;
    let peak = 0;
    points.forEach(function (point) {
      current += point.delta;
      peak = Math.max(peak, current);
    });
    return peak;
  }

  function calculate(trains) {
    const windowMinutes = CONFIG.windowEnd - CONFIG.windowStart;
    const safeTrains = Array.isArray(trains) ? trains : [];
    const modelTrains = safeTrains.map(function (train, index) {
      const number = numberLabel(train);
      return Object.assign({}, train, {
        number: number,
        track: CONFIG.tracks.some(function (item) { return item.id === train.track; }) ? train.track : "1",
        kind: train.kind || "列车",
        color: train.color || PALETTE[index % PALETTE.length],
        arrivalMin: parseTime(train.arrival),
        departureMin: parseTime(train.departure),
      });
    });

    const occupancies = buildOccupancies(modelTrains);
    const conflicts = [];
    checkSectionHeadway(occupancies, conflicts);
    checkSwitchOccupancy(occupancies, conflicts);
    checkTrackConflicts(occupancies, conflicts);
    checkTrainRules(modelTrains, conflicts);

    conflicts.sort(function (a, b) {
      const severityDelta = conflictSeverityRank(a.severity) - conflictSeverityRank(b.severity);
      if (severityDelta !== 0) return severityDelta;
      const timeA = a.time === null ? Number.MAX_SAFE_INTEGER : a.time;
      const timeB = b.time === null ? Number.MAX_SAFE_INTEGER : b.time;
      return timeA - timeB;
    });
    conflicts.forEach(function (conflict, index) {
      conflict.code = "C" + String(index + 1).padStart(2, "0");
      conflict.displayTime = conflict.time === null ? "—" : formatTime(conflict.time);
      conflict.trainIds = Array.from(new Set(conflict.trainIds));
    });

    const trainConflictCounts = new Map();
    modelTrains.forEach(function (train) {
      trainConflictCounts.set(train.id, { severe: 0, warning: 0, total: 0, codes: [] });
    });
    conflicts.forEach(function (conflict) {
      conflict.trainIds.forEach(function (trainId) {
        if (!trainConflictCounts.has(trainId)) return;
        const counts = trainConflictCounts.get(trainId);
        counts[conflict.severity] += 1;
        counts.total += 1;
        counts.codes.push(conflict.code);
      });
    });

    const sectionIntervals = occupancies.filter(function (item) { return item.kind === "section"; });
    const switchIntervals = occupancies.filter(function (item) { return item.kind === "switch"; });
    const trackIntervals = occupancies.filter(function (item) { return item.kind === "track"; });
    const trackMinutesByLine = {};
    CONFIG.tracks.forEach(function (track) {
      trackMinutesByLine[track.id] = unionMinutes(
        trackIntervals
          .filter(function (item) { return item.resource === track.id; })
          .map(function (item) { return { start: item.start, end: item.end }; })
      );
    });

    const sectionMinutes = unionMinutes(sectionIntervals);
    const switchMinutes = unionMinutes(switchIntervals);
    const trackMinutes = Object.values(trackMinutesByLine).reduce(function (sum, value) { return sum + value; }, 0);
    const severeCount = conflicts.filter(function (item) { return item.severity === "severe"; }).length;
    const warningCount = conflicts.filter(function (item) { return item.severity === "warning"; }).length;
    const dwellValues = modelTrains
      .filter(function (train) { return train.arrivalMin !== null && train.departureMin !== null; })
      .map(function (train) { return train.departureMin - train.arrivalMin; })
      .filter(function (value) { return value >= 0; });
    const averageTurnaround = dwellValues.length
      ? dwellValues.reduce(function (sum, value) { return sum + value; }, 0) / dwellValues.length
      : null;

    const stats = {
      plannedTrains: modelTrains.length,
      density: modelTrains.length / (windowMinutes / 60),
      windowMinutes: windowMinutes,
      sectionMinutes: sectionMinutes,
      switchMinutes: switchMinutes,
      trackMinutes: trackMinutes,
      trackMinutesByLine: trackMinutesByLine,
      sectionUtil: sectionMinutes / windowMinutes * 100,
      trackUtil: trackMinutes / (windowMinutes * CONFIG.tracks.length) * 100,
      switchUtil: switchMinutes / windowMinutes * 100,
      headroom: windowMinutes - sectionMinutes,
      peakTracks: calculatePeakTracks(occupancies),
      averageTurnaround: averageTurnaround,
      severeCount: severeCount,
      warningCount: warningCount,
      conflictCount: conflicts.length,
      ready: severeCount === 0 && modelTrains.length > 0,
    };

    return {
      config: CONFIG,
      trains: modelTrains,
      occupancies: occupancies,
      conflicts: conflicts,
      stats: stats,
      trainConflictCounts: trainConflictCounts,
      window: { start: CONFIG.windowStart, end: CONFIG.windowEnd, minutes: windowMinutes },
    };
  }

  function escapeCSV(value) {
    const text = String(value === null || value === undefined ? "" : value);
    if (!/[",\n]/.test(text)) return text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function buildCSV(result) {
    const rows = [
      ["青川站列车时刻表"],
      ["计划窗口", "07:50—09:40", "方案", "QY-06"],
      [],
      ["车次", "股道", "到达", "发车", "折返(min)", "校验", "冲突编号"],
    ];

    result.trains.forEach(function (train) {
      const counts = result.trainConflictCounts.get(train.id) || { severe: 0, warning: 0, codes: [] };
      const dwell = train.arrivalMin !== null && train.departureMin !== null
        ? train.departureMin - train.arrivalMin
        : "";
      rows.push([
        train.number,
        train.track + "道",
        train.arrival,
        train.departure,
        dwell,
        counts.severe ? "严重冲突" : counts.warning ? "提示" : "正常",
        counts.codes.join(" "),
      ]);
    });

    rows.push([]);
    rows.push(["图定列车", result.stats.plannedTrains + " 列"]);
    rows.push(["严重冲突", result.stats.severeCount + " 项"]);
    rows.push(["单线利用率", result.stats.sectionUtil.toFixed(1) + "%"]);
    rows.push(["到发线利用率", result.stats.trackUtil.toFixed(1) + "%"]);
    rows.push(["区间占用", result.stats.sectionMinutes + " min"]);
    rows.push(["到发线占用", result.stats.trackMinutes + " min"]);

    return "\uFEFF" + rows.map(function (row) {
      return row.map(escapeCSV).join(",");
    }).join("\r\n");
  }

  return {
    CONFIG: CONFIG,
    PALETTE: PALETTE,
    DEFAULT_TRAINS: DEFAULT_TRAINS,
    cloneDefaultTrains: cloneDefaultTrains,
    parseTime: parseTime,
    formatTime: formatTime,
    formatDuration: formatDuration,
    calculate: calculate,
    buildCSV: buildCSV,
  };
});
