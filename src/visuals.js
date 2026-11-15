import { ROOM, SPEAKERS } from "./geometry.js";

const NS = "http://www.w3.org/2000/svg";
const VIEW = { x: 82, y: 66, width: 756, height: 426 };

function svgEl(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  if (parent) parent.appendChild(node);
  return node;
}

function worldToView(point) {
  return {
    x: VIEW.x + (point.x / ROOM.width) * VIEW.width,
    y: VIEW.y + (point.y / ROOM.depth) * VIEW.height,
  };
}

export function svgPointToWorld(svg, clientX, clientY) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const local = point.matrixTransform(matrix.inverse());
  return {
    x: Math.min(ROOM.width, Math.max(0, (local.x - VIEW.x) / VIEW.width * ROOM.width)),
    y: Math.min(ROOM.depth, Math.max(0, (local.y - VIEW.y) / VIEW.height * ROOM.depth)),
  };
}

function pointsToString(points) {
  return points
    .map((point) => {
      const viewPoint = worldToView(point);
      return `${viewPoint.x.toFixed(2)},${viewPoint.y.toFixed(2)}`;
    })
    .join(" ");
}

function addDefs(svg) {
  const defs = svgEl("defs", {}, svg);
  defs.innerHTML = `
    <linearGradient id="floorGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#132d2c"/>
      <stop offset="0.54" stop-color="#0c2021"/>
      <stop offset="1" stop-color="#081719"/>
    </linearGradient>
    <radialGradient id="roomHalo">
      <stop offset="0" stop-color="#5bae94" stop-opacity=".11"/>
      <stop offset="1" stop-color="#5bae94" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c7f477" stop-opacity=".2"/>
      <stop offset="1" stop-color="#c7f477" stop-opacity="0"/>
    </radialGradient>
    <filter id="sourceGlow" x="-180%" y="-180%" width="460%" height="460%">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="pathGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="2.2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="wallLight" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d8f5e7" stop-opacity=".27"/>
      <stop offset=".42" stop-color="#86b9a8" stop-opacity=".12"/>
      <stop offset="1" stop-color="#86b9a8" stop-opacity=".04"/>
    </linearGradient>
  `;
}

function addRoomShell(svg) {
  svgEl("ellipse", {
    cx: VIEW.x + VIEW.width / 2,
    cy: VIEW.y + VIEW.height / 2,
    rx: VIEW.width * 0.52,
    ry: VIEW.height * 0.58,
    fill: "url(#roomHalo)",
  }, svg);

  svgEl("rect", {
    x: VIEW.x - 7,
    y: VIEW.y - 7,
    width: VIEW.width + 14,
    height: VIEW.height + 14,
    rx: 3,
    class: "room-svg-room",
  }, svg);
  svgEl("rect", {
    x: VIEW.x,
    y: VIEW.y,
    width: VIEW.width,
    height: VIEW.height,
    class: "room-svg-floor",
  }, svg);

  const grid = svgEl("g", {}, svg);
  for (let meter = 1; meter < ROOM.width; meter += 1) {
    const x = VIEW.x + (meter / ROOM.width) * VIEW.width;
    svgEl("line", {
      x1: x,
      y1: VIEW.y,
      x2: x,
      y2: VIEW.y + VIEW.height,
      class: "room-grid-line",
    }, grid);
  }
  for (let meter = 1; meter < ROOM.depth; meter += 1) {
    const y = VIEW.y + (meter / ROOM.depth) * VIEW.height;
    svgEl("line", {
      x1: VIEW.x,
      y1: y,
      x2: VIEW.x + VIEW.width,
      y2: y,
      class: "room-grid-line",
    }, grid);
  }
  svgEl("line", {
    x1: VIEW.x,
    y1: VIEW.y,
    x2: VIEW.x + VIEW.width,
    y2: VIEW.y + VIEW.height,
    class: "room-diagonal",
  }, grid);
  svgEl("line", {
    x1: VIEW.x + VIEW.width,
    y1: VIEW.y,
    x2: VIEW.x,
    y2: VIEW.y + VIEW.height,
    class: "room-diagonal",
  }, grid);

  svgEl("line", {
    x1: VIEW.x,
    y1: VIEW.y,
    x2: VIEW.x + VIEW.width,
    y2: VIEW.y,
    class: "room-wall",
    stroke: "url(#wallLight)",
  }, svg);
  svgEl("rect", {
    x: VIEW.x,
    y: VIEW.y,
    width: VIEW.width,
    height: VIEW.height,
    class: "room-wall-accent",
  }, svg);

  svgEl("text", {
    x: VIEW.x + 12,
    y: VIEW.y + 18,
    class: "room-origin",
  }, svg).textContent = "0,0";
  svgEl("text", {
    x: VIEW.x + VIEW.width / 2,
    y: VIEW.y - 18,
    class: "room-label",
    "text-anchor": "middle",
  }, svg).textContent = "NORTH / 北";
  svgEl("text", {
    x: VIEW.x - 19,
    y: VIEW.y + VIEW.height / 2,
    class: "room-label",
    "text-anchor": "middle",
    transform: `rotate(-90 ${VIEW.x - 19} ${VIEW.y + VIEW.height / 2})`,
  }, svg).textContent = "7.0 m";
  svgEl("text", {
    x: VIEW.x + VIEW.width / 2,
    y: VIEW.y + VIEW.height + 30,
    class: "room-label",
    "text-anchor": "middle",
  }, svg).textContent = "10.0 m";
}

function addPaths(svg, spatial, showReflections) {
  const pathGroup = svgEl("g", { class: "paths-layer" }, svg);
  const ordered = [
    ...spatial.channels.filter((channel) => !channel.active),
    ...spatial.channels.filter((channel) => channel.active),
  ];
  for (const channel of ordered) {
    const inactive = channel.active ? "" : " inactive";
    const sourcePath = svgEl("polyline", {
      points: pointsToString(channel.sourcePath.points),
      class: `channel-path source-link${inactive}`,
      stroke: channel.color,
    }, pathGroup);
    sourcePath.setAttribute("aria-hidden", "true");

    if (showReflections) {
      channel.reflections.forEach((reflection, index) => {
        svgEl("polyline", {
          points: pointsToString(reflection.points),
          class: `channel-path reflection${inactive}`,
          stroke: channel.color,
          "data-wall": reflection.wallId,
        }, pathGroup);
        const point = worldToView(reflection.hit);
        svgEl("circle", {
          cx: point.x,
          cy: point.y,
          r: channel.active ? 2.2 : 1.6,
          class: "reflect-point",
          fill: channel.color,
          stroke: channel.color,
          opacity: channel.active ? 0.48 + index * 0.08 : 0.12,
        }, pathGroup);
      });
    }

    svgEl("polyline", {
      points: pointsToString(channel.directPath.points),
      class: `channel-path direct${inactive}`,
      stroke: channel.color,
    }, pathGroup);
  }
}

function addSpeakers(svg, spatial) {
  const layer = svgEl("g", { class: "speakers-layer" }, svg);
  for (const speaker of SPEAKERS) {
    const model = spatial.channels.find((channel) => channel.id === speaker.id);
    const point = worldToView(speaker);
    const group = svgEl("g", {
      class: `speaker-group${model?.active ? "" : " inactive"}`,
      transform: `translate(${point.x} ${point.y})`,
      "data-speaker": speaker.id,
    }, layer);
    svgEl("circle", {
      r: 27,
      class: "speaker-aura",
      stroke: speaker.color,
    }, group);
    svgEl("circle", {
      r: 16,
      class: "speaker-ring",
      stroke: speaker.color,
    }, group);
    svgEl("circle", {
      r: 4,
      class: "speaker-core",
      fill: speaker.color,
      stroke: speaker.color,
      opacity: model?.active ? 0.92 : 0.34,
    }, group);
    svgEl("line", {
      x1: -25,
      y1: 0,
      x2: -17,
      y2: 0,
      stroke: speaker.color,
      "stroke-width": 0.8,
      opacity: 0.32,
    }, group);
    svgEl("line", {
      x1: 17,
      y1: 0,
      x2: 25,
      y2: 0,
      stroke: speaker.color,
      "stroke-width": 0.8,
      opacity: 0.32,
    }, group);
    svgEl("text", {
      x: 0,
      y: speaker.y < ROOM.depth / 2 ? -25 : 27,
      class: "speaker-label",
    }, group).textContent = speaker.id;
    svgEl("text", {
      x: 0,
      y: speaker.y < ROOM.depth / 2 ? -37 : 39,
      class: "speaker-name",
    }, group).textContent = `${speaker.short} · ${speaker.name}`;
  }
}

function addSource(svg, state) {
  const point = worldToView(state.source);
  const group = svgEl("g", {
    class: "source-marker drag-handle",
    transform: `translate(${point.x} ${point.y})`,
    "data-drag": "source",
    tabindex: "0",
    role: "slider",
    "aria-label": "声源位置",
  }, svg);
  svgEl("circle", {
    r: 19,
    class: "source-ring",
  }, group);
  svgEl("circle", {
    r: 10,
    fill: "transparent",
  }, group);
  for (const angle of [0, 90, 180, 270]) {
    const radians = (angle * Math.PI) / 180;
    svgEl("line", {
      x1: Math.cos(radians) * 12,
      y1: Math.sin(radians) * 12,
      x2: Math.cos(radians) * 25,
      y2: Math.sin(radians) * 25,
      class: "source-ray",
    }, group);
  }
  svgEl("circle", {
    r: 5.5,
    class: "source-core",
  }, group);
  svgEl("text", {
    x: 0,
    y: -30,
    class: "marker-label",
    "text-anchor": "middle",
  }, group).textContent = "SOURCE";
  svgEl("text", {
    x: 0,
    y: 37,
    class: "drag-tip",
  }, group).textContent = "拖拽声源";
  return group;
}

function addListener(svg, spatial) {
  const listener = spatial.state.listener;
  const point = worldToView(listener);
  const group = svgEl("g", {
    class: "listener-marker drag-handle",
    transform: `translate(${point.x} ${point.y})`,
    "data-drag": "listener",
    tabindex: "0",
    role: "slider",
    "aria-label": "监听位置与朝向",
  }, svg);
  svgEl("circle", {
    r: 29,
    class: "selection-halo",
  }, group);
  const rotated = svgEl("g", {
    transform: `rotate(${listener.yaw})`,
  }, group);
  svgEl("path", {
    d: "M0 0 L37 -13 A40 40 0 0 1 37 13 Z",
    class: "facing-wedge",
  }, rotated);
  svgEl("line", {
    x1: 0,
    y1: 0,
    x2: 46,
    y2: 0,
    stroke: "rgba(101,231,227,.46)",
    "stroke-width": 1,
  }, rotated);
  svgEl("circle", {
    cx: 46,
    cy: 0,
    r: 4.4,
    class: "orientation-handle",
    "data-drag": "orientation",
  }, rotated);
  svgEl("circle", {
    r: 20,
    class: "head-ring",
    "data-drag": "listener",
  }, group);
  svgEl("circle", {
    r: 18,
    fill: "transparent",
    "data-drag": "listener",
  }, group);
  svgEl("circle", {
    r: 8,
    class: "head-core",
  }, group);

  for (const side of ["left", "right"]) {
    const ear = worldToView(spatial.ears[side]);
    svgEl("circle", {
      cx: ear.x - point.x,
      cy: ear.y - point.y,
      r: 2.2,
      class: "ear-dot",
    }, group);
  }

  svgEl("text", {
    x: 0,
    y: 45,
    class: "marker-label",
    "text-anchor": "middle",
  }, group).textContent = "LISTENER";
  svgEl("text", {
    x: 0,
    y: 55,
    class: "drag-tip",
  }, group).textContent = "拖拽 / 旋转耳位";
  return group;
}

export function renderRoom(svg, spatial, options = {}) {
  svg.replaceChildren();
  addDefs(svg);
  addRoomShell(svg);
  addPaths(svg, spatial, options.showReflections !== false);
  addSpeakers(svg, spatial);
  addSource(svg, spatial.state);
  addListener(svg, spatial);
  const speakerIds = new Set(spatial.activeIds);
  svg.dataset.activeChannels = SPEAKERS
    .filter((speaker) => speakerIds.has(speaker.id))
    .map((speaker) => speaker.id)
    .join(",");
}

function prepareCanvas(canvas) {
  const width = Math.max(320, canvas.clientWidth || 720);
  const height = Math.max(170, canvas.clientHeight || 220);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function drawChartGrid(context, width, height, margins, chartMode, duration) {
  context.save();
  context.strokeStyle = "rgba(157, 204, 188, 0.09)";
  context.lineWidth = 0.7;
  context.fillStyle = "rgba(111, 143, 135, 0.7)";
  context.font = '7px "IBM Plex Mono", monospace';
  for (let index = 0; index <= 6; index += 1) {
    const x = margins.left + (index / 6) * (width - margins.left - margins.right);
    context.beginPath();
    context.moveTo(x, margins.top);
    context.lineTo(x, height - margins.bottom);
    context.stroke();
    const time = (index / 6) * duration * 1000;
    context.textAlign = index === 0 ? "left" : index === 6 ? "right" : "center";
    context.fillText(`${time.toFixed(0)} ms`, x, height - 10);
  }
  const rows = chartMode === "decay" ? 4 : 3;
  for (let index = 0; index <= rows; index += 1) {
    const y = margins.top + (index / rows) * (height - margins.top - margins.bottom);
    context.strokeStyle = index === rows ? "rgba(157, 204, 188, 0.15)" : "rgba(157, 204, 188, 0.07)";
    context.beginPath();
    context.moveTo(margins.left, y);
    context.lineTo(width - margins.right, y);
    context.stroke();
    context.textAlign = "left";
    if (chartMode === "decay") {
      const level = -20 * index;
      context.fillText(`${level} dB`, 5, y + 2.5);
    } else {
      const level = 1 - index / rows;
      context.fillText(level.toFixed(1), 15, y + 2.5);
    }
  }
  context.fillStyle = "rgba(111, 143, 135, 0.7)";
  context.textAlign = "left";
  context.fillText("TIME / ARRIVAL", margins.left, 11);
  context.textAlign = "right";
  context.fillText("CHANNEL IMPULSE", width - margins.right, 11);
  context.restore();
}

export function drawImpulseChart(canvas, measurement, chartMode = "impulse") {
  const { context, width, height } = prepareCanvas(canvas);
  if (!measurement?.channels?.length) return;
  const margins = { left: 42, right: 15, top: 20, bottom: 28 };
  const duration = measurement.ir?.duration ?? 1.8;
  drawChartGrid(context, width, height, margins, chartMode, duration);
  const plotWidth = width - margins.left - margins.right;
  const plotHeight = height - margins.top - margins.bottom;
  const centerY = margins.top + plotHeight / 2;

  for (const channel of measurement.channels) {
    const envelope = channel.envelope ?? [];
    if (!envelope.length) continue;
    const active = channel.active;
    const alpha = active ? 0.72 : 0.16;
    let maximum = 0;
    for (const value of envelope) maximum = Math.max(maximum, value);
    if (maximum <= 0) continue;
    context.save();
    context.strokeStyle = channel.color;
    context.fillStyle = channel.color;
    context.globalAlpha = alpha;
    context.lineWidth = active ? 1.15 : 0.7;

    if (chartMode === "decay") {
      const values = envelope.map((value) => {
        const db = 20 * Math.log10(Math.max(value / maximum, 0.0001));
        const clamped = Math.max(-80, Math.min(0, db));
        return margins.top + (-clamped / 80) * plotHeight;
      });
      context.beginPath();
      values.forEach((value, index) => {
        const x = margins.left + (index / (values.length - 1)) * plotWidth;
        if (index === 0) context.moveTo(x, value);
        else context.lineTo(x, value);
      });
      context.stroke();
    } else {
      const positive = envelope.map((value) => {
        const scaled = Math.pow(Math.max(0, value / maximum), 0.34);
        return centerY - scaled * plotHeight * 0.44;
      });
      context.beginPath();
      positive.forEach((value, index) => {
        const x = margins.left + (index / (positive.length - 1)) * plotWidth;
        if (index === 0) context.moveTo(x, value);
        else context.lineTo(x, value);
      });
      context.stroke();
      context.globalAlpha = alpha * 0.24;
      context.beginPath();
      positive.forEach((value, index) => {
        const x = margins.left + (index / (positive.length - 1)) * plotWidth;
        const mirrored = centerY * 2 - value;
        if (index === 0) context.moveTo(x, value);
        else context.lineTo(x, value);
        if (index === positive.length - 1) {
          for (let reverse = positive.length - 1; reverse >= 0; reverse -= 1) {
            const rx = margins.left + (reverse / (positive.length - 1)) * plotWidth;
            context.lineTo(rx, centerY * 2 - positive[reverse]);
          }
          context.closePath();
        }
      });
      context.fill();
    }
    context.restore();

    const onsetX = margins.left + Math.min(
      1,
      Math.max(0, channel.onsetMs / (duration * 1000)),
    ) * plotWidth;
    context.save();
    context.globalAlpha = active ? 0.8 : 0.2;
    context.fillStyle = channel.color;
    context.beginPath();
    context.moveTo(onsetX, height - margins.bottom);
    context.lineTo(onsetX - 3, height - margins.bottom + 5);
    context.lineTo(onsetX + 3, height - margins.bottom + 5);
    context.closePath();
    context.fill();
    context.restore();
  }

  if (measurement.tdoa?.measured != null) {
    context.save();
    context.fillStyle = "rgba(199, 244, 119, .82)";
    context.font = '8px "IBM Plex Mono", monospace';
    context.textAlign = "right";
    context.fillText(
      `TDOA ${measurement.tdoa.measured.toFixed(2)} ms`,
      width - margins.right,
      11,
    );
    context.restore();
  }
}

export function drawSparkline(svg, measurements = []) {
  svg.replaceChildren();
  const width = 240;
  const height = 38;
  const all = measurements.flatMap((measurement) => [
    measurement.tdoa.predicted,
    measurement.tdoa.measured,
  ]);
  if (!all.length) return;
  const maximum = Math.max(0.05, ...all) * 1.2;
  const xFor = (index) => 10 + (index / Math.max(1, measurements.length - 1)) * (width - 28);
  const yFor = (value) => height - 8 - (value / maximum) * (height - 16);

  const makePath = (key, dashed = false) => {
    const path = svgEl("path", {
      d: measurements.map((measurement, index) => (
        `${index === 0 ? "M" : "L"}${xFor(index).toFixed(1)} ${yFor(measurement.tdoa[key]).toFixed(1)}`
      )).join(" "),
      fill: "none",
      stroke: dashed ? "rgba(199,244,119,.45)" : "rgba(101,231,227,.72)",
      "stroke-width": dashed ? 0.8 : 1.2,
      "stroke-dasharray": dashed ? "3 3" : "",
    });
    svg.appendChild(path);
  };
  makePath("predicted", true);
  makePath("measured", false);
  measurements.forEach((measurement, index) => {
    svgEl("circle", {
      cx: xFor(index),
      cy: yFor(measurement.tdoa.measured),
      r: 2,
      fill: "#c7f477",
    }, svg);
  });
}
