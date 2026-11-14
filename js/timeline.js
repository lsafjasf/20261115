export const CANVAS = Object.freeze({
  width: 1280,
  height: 720,
  fps: 30,
});

export const SAMPLE_CREDITS = `在代码的夜里
我们点起一盏灯

风穿过像素森林
海面升起微光

献给每一次耐心等待
以及仍未命名的远方

每一帧都有回声
每一次播放都是重逢

—— 制作者
2026 · 程序影像`;

export const DEFAULT_CONFIG = Object.freeze({
  speed: 66,
  hold: 0.7,
  lineHeight: 74,
  fontSize: 38,
  entryOffset: 62,
  exitMargin: 44,
  focusRatio: 0.46,
  slowFactor: 0.46,
  slowRadius: 30,
  maxTextWidth: 930,
  fadeEnabled: true,
  fadeStart: 0.82,
});

export function parseCredits(text) {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.map((line) => ({
    text: line.trim(),
    blank: line.trim() === "",
  }));
}

function splitText(text, measureText, maxWidth) {
  const pieces = [];
  let remaining = Array.from(text);

  while (remaining.length) {
    let candidate = "";
    let fitting = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      const next = candidate + remaining[index];
      if (measureText(next) > maxWidth && candidate) break;
      candidate = next;
      fitting = index + 1;
    }

    if (!fitting) {
      candidate = remaining[0];
      fitting = 1;
    }

    if (fitting < remaining.length) {
      const slice = remaining.slice(0, fitting).join("");
      const breakAt = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("，"), slice.lastIndexOf("、"));
      if (breakAt > slice.length * 0.45) {
        const head = slice.slice(0, breakAt + 1).trim();
        pieces.push(head);
        remaining = Array.from(slice.slice(breakAt + 1).trim() + remaining.slice(fitting).join(""));
        continue;
      }
    }

    pieces.push(candidate.trim());
    remaining = remaining.slice(fitting);
  }

  return pieces.filter(Boolean);
}

export function buildTrackModel(text, measureText, config = DEFAULT_CONFIG) {
  const sourceLines = parseCredits(text);
  const rows = [];
  const logicalLines = [];
  const groups = [];
  let activeGroup = null;

  sourceLines.forEach((source, sourceLine) => {
    if (source.blank) {
      activeGroup = null;
      rows.push({
        text: "",
        blank: true,
        sourceLine,
        logicalIndex: null,
        firstSegment: false,
        lastSegment: false,
      });
      return;
    }

    const chunks = splitText(source.text, measureText, config.maxTextWidth);
    const logicalIndex = logicalLines.length;
    const rowStart = rows.length;

    chunks.forEach((chunk, chunkIndex) => {
      rows.push({
        text: chunk,
        blank: false,
        sourceLine,
        logicalIndex,
        firstSegment: chunkIndex === 0,
        lastSegment: chunkIndex === chunks.length - 1,
      });
    });

    const logical = {
      index: logicalIndex,
      sourceLine,
      text: source.text,
      rowStart,
      rowEnd: rows.length - 1,
    };
    logicalLines.push(logical);

    if (!activeGroup) {
      activeGroup = {
        index: groups.length,
        rowStart,
        rowEnd: rows.length - 1,
        lines: [],
      };
      groups.push(activeGroup);
    }
    activeGroup.lines.push(logical);
    activeGroup.rowEnd = rows.length - 1;
  });

  return {
    sourceLines,
    rows,
    logicalLines,
    groups,
    lineCount: logicalLines.length,
    blankCount: rows.filter((row) => row.blank).length,
    rawTextWidths: logicalLines.map((line) => measureText(line.text)),
    visualWidths: rows.filter((row) => !row.blank).map((row) => measureText(row.text)),
  };
}

export function createGeometry(model, config = DEFAULT_CONFIG) {
  const lineHeight = config.lineHeight ?? DEFAULT_CONFIG.lineHeight;
  const initialTop = CANVAS.height + (config.entryOffset ?? DEFAULT_CONFIG.entryOffset);
  const trackHeight = model.rows.length * lineHeight;
  const maxScroll = initialTop + trackHeight + (config.exitMargin ?? DEFAULT_CONFIG.exitMargin);
  const focusY = CANVAS.height * (config.focusRatio ?? DEFAULT_CONFIG.focusRatio);

  const rows = model.rows.map((row, index) => ({
    ...row,
    index,
    top: index * lineHeight,
    bottom: (index + 1) * lineHeight,
    center: (index + 0.5) * lineHeight,
  }));

  const activeHolds = collectHoldGroups(rows, lineHeight)
    .map((group) => ({
      ...group,
      scroll: initialTop - focusY + group.center,
    }))
    .filter((hold) => hold.scroll > 0 && hold.scroll < maxScroll);

  return {
    rows,
    lineHeight,
    initialTop,
    trackHeight,
    maxScroll,
    focusY,
    holds: activeHolds,
  };
}

function collectHoldGroups(rows, lineHeight) {
  const groups = [];
  let start = null;

  rows.forEach((row, index) => {
    if (row.blank && start === null) start = index;
    if (!row.blank && start !== null) {
      groups.push({
        start,
        end: index - 1,
        center: ((start + index) / 2) * lineHeight,
      });
      start = null;
    }
  });

  if (start !== null) {
    groups.push({
      start,
      end: rows.length - 1,
      center: ((start + rows.length) / 2) * lineHeight,
    });
  }
  return groups;
}

function smoothstep(value) {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

export function slowFactorAtScroll(geometry, scroll, config = DEFAULT_CONFIG) {
  const slowFactor = config.slowFactor ?? DEFAULT_CONFIG.slowFactor;
  const slowRadius = config.slowRadius ?? DEFAULT_CONFIG.slowRadius;
  const trackPosition = scroll + geometry.focusY - geometry.initialTop;
  const innerRadius = geometry.lineHeight * 0.5 + 10;
  let factor = 1;

  for (const row of geometry.rows) {
    if (!row.blank) continue;
    const distance = Math.abs(trackPosition - row.center);
    if (distance >= innerRadius + slowRadius) continue;
    const local =
      distance <= innerRadius
        ? slowFactor
        : slowFactor +
          (1 - slowFactor) * smoothstep((distance - innerRadius) / slowRadius);
    factor = Math.min(factor, local);
  }

  for (const hold of geometry.holds) {
    const distance = Math.abs(scroll - hold.scroll);
    if (distance >= slowRadius) continue;
    factor = Math.min(factor, slowFactor + (1 - slowFactor) * smoothstep(distance / slowRadius));
  }

  return factor;
}

export function buildTimeline(geometry, config = DEFAULT_CONFIG) {
  const speed = Math.max(1, config.speed ?? DEFAULT_CONFIG.speed);
  const holdSeconds = Math.max(0, config.hold ?? DEFAULT_CONFIG.hold);
  const step = 2;
  const points = [{ scroll: 0, time: 0 }];
  let scroll = 0;
  let time = 0;
  let holdIndex = 0;

  const append = () => points.push({ scroll, time });

  while (scroll < geometry.maxScroll - 0.0001) {
    const hold = geometry.holds[holdIndex];
    if (hold && Math.abs(scroll - hold.scroll) < 0.0001) {
      if (holdSeconds > 0) {
        time += holdSeconds;
        append();
      }
      holdIndex += 1;
      continue;
    }

    let limit = geometry.maxScroll;
    if (hold && hold.scroll > scroll + 0.0001) limit = Math.min(limit, hold.scroll);

    const distance = Math.min(step, limit - scroll);
    const factor = slowFactorAtScroll(geometry, scroll + distance * 0.5, config);
    time += distance / (speed * factor);
    scroll += distance;
    append();
  }

  return {
    points,
    duration: time,
    slowDuration: points.reduce((total, point, index) => {
      if (!index) return total;
      const previous = points[index - 1];
      const middle = (previous.scroll + point.scroll) * 0.5;
      return slowFactorAtScroll(geometry, middle, config) < 0.999
        ? total + (point.time - previous.time)
        : total;
    }, 0),
  };
}

export function scrollAtTime(timeline, time) {
  const target = Math.min(Math.max(0, time), timeline.duration);
  const points = timeline.points;
  let low = 0;
  let high = points.length - 1;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (points[middle].time <= target) low = middle;
    else high = middle - 1;
  }

  const current = points[low];
  const next = points[low + 1];
  if (!next || next.time === current.time) return current.scroll;
  const progress = (target - current.time) / (next.time - current.time);
  return current.scroll + (next.scroll - current.scroll) * progress;
}

export function timeAtScroll(timeline, scroll) {
  const target = Math.min(Math.max(0, scroll), timeline.points[timeline.points.length - 1].scroll);
  const points = timeline.points;
  let low = 0;
  let high = points.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].scroll < target) low = middle + 1;
    else high = middle;
  }

  const current = points[low];
  const previous = points[low - 1];
  if (!previous || current.scroll === previous.scroll) return current.time;
  const progress = (target - previous.scroll) / (current.scroll - previous.scroll);
  return previous.time + (current.time - previous.time) * progress;
}

export function currentRowState(geometry, scroll) {
  const position = scroll + geometry.focusY - geometry.initialTop;
  const index = Math.floor(position / geometry.lineHeight);
  const row = geometry.rows[Math.max(0, Math.min(geometry.rows.length - 1, index))];
  return {
    index,
    row,
    onBlank: Boolean(row?.blank),
    position,
  };
}

export function buildCues(model, geometry, timeline) {
  const visibleTop = 48;
  const visibleBottom = CANVAS.height - 42;

  return model.groups
    .map((group) => {
      const firstRow = geometry.rows[group.rowStart];
      const lastRow = geometry.rows[group.rowEnd];
      const startScroll = Math.max(
        0,
        geometry.initialTop + firstRow.top - visibleBottom
      );
      const endScroll = Math.min(
        geometry.maxScroll,
        geometry.initialTop + lastRow.bottom - visibleTop
      );
      const start = timeAtScroll(timeline, startScroll);
      const end = Math.max(start + 0.2, timeAtScroll(timeline, endScroll));

      return {
        id: `stanza-${group.index + 1}`,
        start,
        end: Math.min(end, timeline.duration),
        text: group.lines.map((line) => line.text).join("\n"),
        lines: group.lines.length,
      };
    })
    .filter((cue) => cue.end > cue.start && cue.text.trim());
}

export function validateLayout(model, geometry, timeline, config = DEFAULT_CONFIG, cueCount = 0) {
  const firstTop = geometry.initialTop;
  const finalTrackBottom = geometry.initialTop - geometry.maxScroll + geometry.trackHeight;
  const startBelowFrame = firstTop >= CANVAS.height;
  const lastLeavesFrame = finalTrackBottom <= 0;
  const positiveDuration = timeline.duration > 0;
  const horizontalSafe = model.visualWidths.every(
    (width) => width <= (config.maxTextWidth ?? DEFAULT_CONFIG.maxTextWidth)
  );
  const holdCount = geometry.holds.length;
  const safe = startBelowFrame && lastLeavesFrame && positiveDuration && horizontalSafe;

  return {
    safe,
    startBelowFrame,
    lastLeavesFrame,
    positiveDuration,
    horizontalSafe,
    lineCount: model.lineCount,
    checkedLineCount: model.lineCount,
    blankCount: model.blankCount,
    holdCount,
    cueCount,
    firstTop,
    finalTrackBottom,
    maxTextWidth: Math.max(0, ...model.visualWidths),
  };
}

export function formatDuration(seconds, includeTenths = true) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  if (!includeTenths) return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`;
  const tenths = Math.floor((safe - Math.floor(safe)) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${tenths}`;
}

export function formatTimecode(seconds) {
  return formatDuration(seconds, true);
}

export function formatVTTTime(seconds) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const milliseconds = Math.floor((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

export function buildWebVTT(cues, duration) {
  const header = [
    "WEBVTT",
    "",
    "NOTE 夜航之后 · 程序生成片尾字幕",
    `NOTE Duration ${formatVTTTime(duration)} · ${cues.length} cues`,
    "X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0",
    "",
  ];

  const blocks = cues.map(
    (cue, index) =>
      `${index + 1}\n${formatVTTTime(cue.start)} --> ${formatVTTTime(cue.end)}\n${cue.text}`
  );

  return `${header.join("\n")}\n${blocks.join("\n\n")}\n`;
}

export function getFadeAmount(time, duration, config = DEFAULT_CONFIG) {
  if (!config.fadeEnabled) return 0;
  const start = Math.max(0, Math.min(0.98, config.fadeStart ?? DEFAULT_CONFIG.fadeStart));
  const progress = (time / Math.max(duration, 0.001) - start) / (1 - start);
  return smoothstep(progress);
}
