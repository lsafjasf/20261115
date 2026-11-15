(function () {
  "use strict";

  const BOUNDS = Object.freeze({ west: 118.0, east: 123.2, south: 29.1, north: 32.8 });
  const GRID = Object.freeze({ cols: 156, rows: 100 });
  const FRAME_COUNT = 12;
  const FRAME_INTERVAL_MS = 10 * 60 * 1000;
  const START_TIME = new Date("2026-11-15T08:00:00+08:00").getTime();

  const COLOR_STOPS = [
    { value: 10, color: [95, 215, 184], alpha: 0.2 },
    { value: 18, color: [84, 220, 131], alpha: 0.35 },
    { value: 26, color: [155, 224, 78], alpha: 0.52 },
    { value: 34, color: [231, 221, 76], alpha: 0.68 },
    { value: 42, color: [255, 184, 67], alpha: 0.8 },
    { value: 50, color: [255, 118, 62], alpha: 0.9 },
    { value: 58, color: [245, 68, 98], alpha: 0.96 },
    { value: 66, color: [206, 87, 242], alpha: 1 }
  ];

  const STORMS = [
    { lon: 119.24, lat: 30.08, sx: 0.19, sy: 0.15, peak: 51, angle: 0.4 },
    { lon: 119.48, lat: 30.27, sx: 0.23, sy: 0.17, peak: 61, angle: 0.52 },
    { lon: 119.72, lat: 30.48, sx: 0.18, sy: 0.14, peak: 57, angle: 0.62 },
    { lon: 119.98, lat: 30.68, sx: 0.2, sy: 0.15, peak: 48, angle: 0.68 },
    { lon: 120.2, lat: 30.82, sx: 0.15, sy: 0.13, peak: 42, angle: 0.72 },
    { lon: 119.38, lat: 31.03, sx: 0.28, sy: 0.2, peak: 35, angle: -0.2 },
    { lon: 120.2, lat: 31.44, sx: 0.25, sy: 0.16, peak: 41, angle: 0.15 },
    { lon: 121.15, lat: 31.08, sx: 0.2, sy: 0.14, peak: 31, angle: 0.35 },
    { lon: 121.7, lat: 30.42, sx: 0.17, sy: 0.13, peak: 25, angle: 0.1 }
  ];

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function timeLabel(timestamp) {
    const date = new Date(timestamp + 8 * 60 * 60 * 1000);
    return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }

  function dateLabel(timestamp) {
    const date = new Date(timestamp + 8 * 60 * 60 * 1000);
    return `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`;
  }

  function fileStamp(timestamp) {
    const date = new Date(timestamp + 8 * 60 * 60 * 1000);
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
  }

  function hashNoise(x, y, seed) {
    const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
    return value - Math.floor(value);
  }

  function smoothNoise(x, y, seed) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hashNoise(xi, yi, seed);
    const b = hashNoise(xi + 1, yi, seed);
    const c = hashNoise(xi, yi + 1, seed);
    const d = hashNoise(xi + 1, yi + 1, seed);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  function lonAt(col) {
    return BOUNDS.west + ((col + 0.5) / GRID.cols) * (BOUNDS.east - BOUNDS.west);
  }

  function latAt(row) {
    return BOUNDS.north - ((row + 0.5) / GRID.rows) * (BOUNDS.north - BOUNDS.south);
  }

  function gridAt(lon, lat) {
    const col = Math.floor(((lon - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * GRID.cols);
    const row = Math.floor(((BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south)) * GRID.rows);
    return {
      col: Math.max(0, Math.min(GRID.cols - 1, col)),
      row: Math.max(0, Math.min(GRID.rows - 1, row))
    };
  }

  function addBlob(field, storm, drift, phase) {
    const angle = storm.angle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const lon = storm.lon + drift.x;
    const lat = storm.lat + drift.y + Math.sin(phase + storm.lon * 8) * 0.025;
    const pulse = Math.sin(phase * 1.7 + storm.lat * 5) * 0.08;
    const peak = storm.peak * (1 + pulse);
    const lonRadius = storm.sx * (1 + Math.sin(phase + storm.lon) * 0.05);
    const latRadius = storm.sy * (1 + Math.cos(phase + storm.lat) * 0.04);

    const colStart = Math.max(0, Math.floor(((lon - 3 * lonRadius - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * GRID.cols));
    const colEnd = Math.min(GRID.cols, Math.ceil(((lon + 3 * lonRadius - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * GRID.cols));
    const rowStart = Math.max(0, Math.floor(((BOUNDS.north - lat - 3 * latRadius) / (BOUNDS.north - BOUNDS.south)) * GRID.rows));
    const rowEnd = Math.min(GRID.rows, Math.ceil(((BOUNDS.north - lat + 3 * latRadius) / (BOUNDS.north - BOUNDS.south)) * GRID.rows));

    for (let row = rowStart; row < rowEnd; row += 1) {
      const dyRaw = latAt(row) - lat;
      for (let col = colStart; col < colEnd; col += 1) {
        const dxRaw = lonAt(col) - lon;
        const dx = dxRaw * cos + dyRaw * sin;
        const dy = -dxRaw * sin + dyRaw * cos;
        const distance = (dx / lonRadius) ** 2 + (dy / latRadius) ** 2;
        const value = peak * Math.exp(-distance * 0.82);
        const index = row * GRID.cols + col;
        if (value > field[index]) {
          field[index] = value;
        }
      }
    }
  }

  function addRainBand(field, progress, frameIndex) {
    for (let row = 0; row < GRID.rows; row += 1) {
      const lat = latAt(row);
      for (let col = 0; col < GRID.cols; col += 1) {
        const lon = lonAt(col);
        const route = 30.02 + (lon - 118.8) * 0.32 + Math.sin((lon - 118.8) * 2.4 + progress * 2) * 0.1 + progress * 0.16;
        const along = Math.exp(-(((lon - (119.72 + progress * 0.55)) / 0.92) ** 2));
        const across = Math.exp(-(((lat - route) / 0.105) ** 2));
        const broken = 0.72 + 0.28 * smoothNoise(lon * 4.2, lat * 4.2, 7 + frameIndex);
        const value = 28 * along * across * broken;
        const index = row * GRID.cols + col;
        if (value > field[index]) {
          field[index] = value;
        }
      }
    }
  }

  function addScatteredCells(field, progress, frameIndex) {
    const count = 7;
    for (let index = 0; index < count; index += 1) {
      const seed = frameIndex * 13.7 + index * 8.4;
      const lon = 119.1 + ((index * 0.57 + progress * 0.3) % 3.5);
      const lat = 29.65 + ((index * 0.39 + progress * 0.06) % 2.2);
      const radius = 0.045 + hashNoise(index, frameIndex, 3) * 0.07;
      const peak = 17 + hashNoise(index, frameIndex, 9) * 28;

      for (let row = 0; row < GRID.rows; row += 1) {
        const dy = latAt(row) - lat;
        for (let col = 0; col < GRID.cols; col += 1) {
          const dx = lonAt(col) - lon;
          if (Math.abs(dx) > radius * 2.8 || Math.abs(dy) > radius * 2.8) {
            continue;
          }
          const distance = (dx * dx + dy * dy) / (radius * radius);
          const value = peak * Math.exp(-distance) * (0.8 + hashNoise(col, row, seed) * 0.35);
          const offset = row * GRID.cols + col;
          if (value > field[offset]) {
            field[offset] = value;
          }
        }
      }
    }
  }

  function generateFrame(frameIndex) {
    const progress = frameIndex / (FRAME_COUNT - 1);
    const phase = progress * 2.6;
    const drift = { x: progress * 0.7, y: progress * 0.06 };
    const field = new Float32Array(GRID.cols * GRID.rows);

    STORMS.forEach((storm) => addBlob(field, storm, drift, phase));
    addRainBand(field, progress, frameIndex);
    addScatteredCells(field, progress, frameIndex);

    for (let row = 0; row < GRID.rows; row += 1) {
      for (let col = 0; col < GRID.cols; col += 1) {
        const index = row * GRID.cols + col;
        if (field[index] < 8) {
          field[index] = Number.NaN;
          continue;
        }
        const fine = smoothNoise(col * 0.12, row * 0.12, 21 + frameIndex) - 0.5;
        const grain = (hashNoise(col, row, frameIndex + 2) - 0.5) * 3.5;
        field[index] = Math.max(0, Math.min(69, field[index] + fine * 8 + grain));
      }
    }

    const timestamp = START_TIME + frameIndex * FRAME_INTERVAL_MS;
    return {
      index: frameIndex,
      timestamp,
      iso: new Date(timestamp).toISOString(),
      label: timeLabel(timestamp),
      date: dateLabel(timestamp),
      fileStamp: fileStamp(timestamp),
      field
    };
  }

  const frames = Array.from({ length: FRAME_COUNT }, (_, index) => generateFrame(index));

  function sample(frameIndex, lon, lat) {
    const frame = frames[Math.max(0, Math.min(FRAME_COUNT - 1, frameIndex))];
    if (!frame || lon < BOUNDS.west || lon > BOUNDS.east || lat < BOUNDS.south || lat > BOUNDS.north) {
      return null;
    }
    const position = gridAt(lon, lat);
    const raw = frame.field[position.row * GRID.cols + position.col];
    return {
      frameIndex: frame.index,
      lon,
      lat,
      col: position.col,
      row: position.row,
      dbz: Number.isFinite(raw) ? Math.round(raw * 10) / 10 : null
    };
  }

  function colorForDbz(dbz) {
    if (!Number.isFinite(dbz) || dbz < 8) {
      return { color: [62, 88, 94], alpha: 0 };
    }
    const clamped = Math.max(COLOR_STOPS[0].value, Math.min(COLOR_STOPS[COLOR_STOPS.length - 1].value, dbz));
    for (let index = 1; index < COLOR_STOPS.length; index += 1) {
      const previous = COLOR_STOPS[index - 1];
      const current = COLOR_STOPS[index];
      if (clamped <= current.value) {
        const ratio = (clamped - previous.value) / (current.value - previous.value);
        return {
          color: previous.color.map((channel, channelIndex) => Math.round(channel + (current.color[channelIndex] - channel) * ratio)),
          alpha: previous.alpha + (current.alpha - previous.alpha) * ratio
        };
      }
    }
    const last = COLOR_STOPS[COLOR_STOPS.length - 1];
    return { color: last.color, alpha: last.alpha };
  }

  function classify(dbz) {
    if (!Number.isFinite(dbz)) {
      return { label: "无回波", tone: "waiting" };
    }
    if (dbz >= 58) {
      return { label: "极端回波", tone: "severe" };
    }
    if (dbz >= 46) {
      return { label: "强回波", tone: "strong" };
    }
    if (dbz >= 28) {
      return { label: "中等回波", tone: "" };
    }
    return { label: "弱回波", tone: "light" };
  }

  window.RadarData = Object.freeze({
    BOUNDS,
    GRID,
    FRAME_COUNT,
    FRAME_INTERVAL_MS,
    COLOR_STOPS,
    frames,
    sample,
    colorForDbz,
    classify,
    lonAt,
    latAt,
    gridAt
  });
})();
