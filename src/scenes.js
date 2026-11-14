const TAU = Math.PI * 2;

function mountainLayer(ctx) {
  ctx.beginPath();
  ctx.moveTo(-0.56, 0.22);
  ctx.lineTo(-0.42, -0.02);
  ctx.lineTo(-0.34, 0.07);
  ctx.lineTo(-0.23, -0.20);
  ctx.lineTo(-0.10, 0.06);
  ctx.lineTo(0.01, -0.28);
  ctx.lineTo(0.16, 0.02);
  ctx.lineTo(0.29, -0.13);
  ctx.lineTo(0.42, 0.13);
  ctx.lineTo(0.55, 0.05);
  ctx.lineTo(0.56, 0.48);
  ctx.lineTo(-0.56, 0.48);
  ctx.closePath();
  ctx.fill();
}

function birdLayer(ctx) {
  const birds = [
    [-0.30, -0.18, 0.052], [-0.19, -0.29, 0.034], [-0.07, -0.22, 0.045],
    [0.04, -0.33, 0.028], [0.13, -0.17, 0.038], [0.27, -0.27, 0.030],
    [0.33, -0.11, 0.023], [-0.38, -0.30, 0.024],
  ];
  for (const [x, y, s] of birds) {
    ctx.beginPath();
    ctx.moveTo(x - s, y);
    ctx.quadraticCurveTo(x - s * 0.45, y - s * 0.58, x, y - s * 0.08);
    ctx.quadraticCurveTo(x + s * 0.45, y - s * 0.58, x + s, y);
    ctx.quadraticCurveTo(x + s * 0.42, y - s * 0.12, x, y + s * 0.10);
    ctx.quadraticCurveTo(x - s * 0.42, y - s * 0.12, x - s, y);
    ctx.fill();
  }
}

function boatLayer(ctx) {
  ctx.beginPath();
  ctx.moveTo(-0.30, 0.18);
  ctx.quadraticCurveTo(0, 0.34, 0.32, 0.17);
  ctx.lineTo(0.24, 0.27);
  ctx.quadraticCurveTo(0, 0.38, -0.22, 0.27);
  ctx.closePath();
  ctx.fill();

  ctx.fillRect(-0.012, -0.27, 0.024, 0.45);
  ctx.beginPath();
  ctx.moveTo(0.02, -0.25);
  ctx.lineTo(0.25, 0.07);
  ctx.lineTo(0.02, 0.10);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.025, -0.19);
  ctx.lineTo(-0.18, 0.06);
  ctx.lineTo(-0.025, 0.09);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(-0.09, 0.03, 0.027, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.13, 0.18);
  ctx.quadraticCurveTo(-0.09, 0.04, -0.04, 0.18);
  ctx.closePath();
  ctx.fill();
}

function waveLayer(ctx) {
  ctx.lineCap = "round";
  const waves = [
    [-0.52, 0.26, 0.48, 0.055], [-0.36, 0.34, 0.57, 0.035],
    [-0.50, 0.42, 0.38, 0.040], [-0.05, 0.47, 0.48, 0.030],
    [0.12, 0.29, 0.41, 0.022],
  ];
  for (const [x, y, w, weight] of waves) {
    ctx.lineWidth = weight;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 0; i < 4; i += 1) {
      const px = x + (w / 4) * i;
      ctx.quadraticCurveTo(px + w / 8, y - 0.045, px + w / 4, y);
    }
    ctx.stroke();
  }
}

function pineLayer(ctx) {
  ctx.lineCap = "round";
  ctx.lineWidth = 0.028;
  ctx.beginPath();
  ctx.moveTo(-0.52, -0.24);
  ctx.quadraticCurveTo(-0.20, -0.18, 0.17, -0.31);
  ctx.quadraticCurveTo(0.37, -0.37, 0.55, -0.28);
  ctx.stroke();
  ctx.lineWidth = 0.017;
  ctx.beginPath();
  ctx.moveTo(-0.33, -0.21);
  ctx.quadraticCurveTo(-0.20, -0.34, -0.04, -0.36);
  ctx.moveTo(-0.03, -0.28);
  ctx.quadraticCurveTo(0.07, -0.43, 0.23, -0.45);
  ctx.moveTo(0.20, -0.32);
  ctx.quadraticCurveTo(0.33, -0.46, 0.48, -0.43);
  ctx.stroke();

  const needles = [
    [-0.34, -0.22], [-0.26, -0.25], [-0.17, -0.27], [-0.07, -0.28],
    [0.04, -0.32], [0.12, -0.39], [0.20, -0.41], [0.29, -0.40],
    [0.37, -0.38], [0.45, -0.33],
  ];
  for (let i = 0; i < needles.length; i += 1) {
    const [x, y] = needles[i];
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 0.016, y - 0.09);
    ctx.lineTo(x + 0.012, y - 0.072);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.042, y - 0.066);
    ctx.lineTo(x + 0.012, y - 0.045);
    ctx.closePath();
    ctx.fill();
  }
}

function ridgeLayer(ctx) {
  ctx.beginPath();
  ctx.moveTo(-0.57, 0.24);
  ctx.lineTo(-0.37, -0.06);
  ctx.lineTo(-0.25, 0.05);
  ctx.lineTo(-0.08, -0.31);
  ctx.lineTo(0.07, -0.08);
  ctx.lineTo(0.20, -0.21);
  ctx.lineTo(0.34, 0.06);
  ctx.lineTo(0.49, -0.09);
  ctx.lineTo(0.57, 0.27);
  ctx.lineTo(0.57, 0.48);
  ctx.lineTo(-0.57, 0.48);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0.31, -0.33, 0.075, 0, TAU);
  ctx.fill();
}

function craneLayer(ctx) {
  ctx.beginPath();
  ctx.ellipse(0, 0.02, 0.10, 0.045, -0.08, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.08, -0.01);
  ctx.quadraticCurveTo(-0.02, -0.16, 0.08, -0.02);
  ctx.lineTo(0.16, -0.01);
  ctx.quadraticCurveTo(0.08, 0.05, -0.05, 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.06, 0.01);
  ctx.quadraticCurveTo(-0.30, -0.22, -0.52, -0.17);
  ctx.quadraticCurveTo(-0.28, -0.02, -0.03, 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.04, -0.01);
  ctx.quadraticCurveTo(0.23, -0.24, 0.44, -0.34);
  ctx.quadraticCurveTo(0.25, -0.06, 0.08, 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 0.010;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0.10, -0.01);
  ctx.quadraticCurveTo(0.17, -0.09, 0.21, -0.07);
  ctx.moveTo(-0.02, -0.02);
  ctx.lineTo(-0.08, 0.13);
  ctx.moveTo(0.03, -0.02);
  ctx.lineTo(0.02, 0.14);
  ctx.stroke();
}

function reedLayer(ctx) {
  ctx.lineCap = "round";
  const reeds = [
    [-0.45, 0.44, -0.20, 0.20], [-0.38, 0.46, -0.31, -0.20],
    [-0.29, 0.46, -0.24, -0.28], [0.35, 0.46, 0.26, 0.18],
    [0.43, 0.46, 0.37, -0.16], [0.49, 0.45, 0.53, -0.24],
  ];
  for (const [x, y, cx, ty] of reeds) {
    ctx.lineWidth = 0.011;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(cx, y * 0.45, cx, ty);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, ty, 0.018, 0.052, -0.15, 0, TAU);
    ctx.fill();
  }
}

function skylineLayer(ctx) {
  const buildings = [
    [-0.54, 0.08, 0.10, 0.36], [-0.43, -0.04, 0.075, 0.49],
    [-0.35, 0.13, 0.07, 0.32], [-0.27, -0.16, 0.10, 0.61],
    [-0.16, 0.02, 0.085, 0.42], [-0.075, -0.06, 0.065, 0.51],
    [0.00, 0.12, 0.095, 0.33], [0.11, -0.22, 0.072, 0.68],
    [0.19, 0.04, 0.08, 0.42], [0.28, -0.10, 0.10, 0.56],
    [0.39, 0.09, 0.075, 0.37], [0.47, -0.03, 0.09, 0.49],
  ];
  for (const [x, y, w, h] of buildings) {
    ctx.fillRect(x, y, w, h + 0.08);
  }
  ctx.beginPath();
  ctx.moveTo(0.11, -0.22);
  ctx.lineTo(0.146, -0.40);
  ctx.lineTo(0.182, -0.22);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(0.139, -0.47, 0.014, 0.19);
  ctx.beginPath();
  ctx.arc(0.146, -0.48, 0.018, 0, TAU);
  ctx.fill();
}

function moonLayer(ctx) {
  ctx.beginPath();
  ctx.arc(0.22, -0.29, 0.13, 0, TAU);
  ctx.fill();
  ctx.lineCap = "round";
  ctx.lineWidth = 0.026;
  ctx.beginPath();
  ctx.moveTo(-0.38, -0.37);
  ctx.quadraticCurveTo(-0.24, -0.45, -0.04, -0.40);
  ctx.moveTo(0.12, -0.44);
  ctx.quadraticCurveTo(0.38, -0.50, 0.51, -0.39);
  ctx.moveTo(0.31, -0.25);
  ctx.quadraticCurveTo(0.44, -0.29, 0.53, -0.24);
  ctx.stroke();
}

function lampLayer(ctx) {
  const lamps = [[-0.42, 0.44, -0.42, -0.16], [0.08, 0.44, 0.08, -0.06], [0.43, 0.44, 0.43, -0.21]];
  for (const [x, base, cx, top] of lamps) {
    ctx.lineWidth = 0.014;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(cx, top);
    ctx.moveTo(cx, top);
    ctx.lineTo(cx - 0.075, top);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 0.080, top + 0.002);
    ctx.lineTo(cx - 0.090, top + 0.062);
    ctx.lineTo(cx - 0.050, top + 0.062);
    ctx.lineTo(cx - 0.057, top + 0.002);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - 0.069, top + 0.070, 0.020, 0, TAU);
    ctx.fill();
  }
}

function walkerLayer(ctx) {
  ctx.beginPath();
  ctx.arc(-0.04, 0.02, 0.045, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.09, 0.07);
  ctx.quadraticCurveTo(-0.02, 0.03, 0.04, 0.08);
  ctx.lineTo(0.07, 0.28);
  ctx.lineTo(-0.09, 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.lineCap = "round";
  ctx.lineWidth = 0.025;
  ctx.beginPath();
  ctx.moveTo(-0.03, 0.27);
  ctx.lineTo(-0.11, 0.46);
  ctx.moveTo(0.02, 0.27);
  ctx.lineTo(0.11, 0.44);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.01, 0.10);
  ctx.lineTo(-0.17, 0.20);
  ctx.stroke();
  ctx.lineWidth = 0.032;
  ctx.beginPath();
  ctx.moveTo(-0.24, 0.13);
  ctx.quadraticCurveTo(-0.03, -0.07, 0.20, 0.14);
  ctx.stroke();
  ctx.lineWidth = 0.012;
  ctx.beginPath();
  ctx.moveTo(-0.02, 0.12);
  ctx.lineTo(-0.02, 0.38);
  ctx.stroke();
}

export const SCENES = [
  {
    id: "tide",
    title: "潮汐信使",
    english: "TIDAL COURIER",
    mood: "暮色 · 湖面",
    accent: "CH. 01",
    description: "让归鸟掠过山口，把一叶来信交给最后一束潮光。",
    palette: {
      wallTop: "#ead5ad", wallBottom: "#9b6645", glow: "#ffd08a",
      ink: ["#4f3124", "#3f2b22", "#2b1c17", "#5d3825"], grain: "#533622",
    },
    layers: [
      { id: "ridge", name: "远山", angle: -2, spacing: 72, draw: mountainLayer },
      { id: "birds", name: "归鸟", angle: 3, spacing: 56, draw: birdLayer },
      { id: "boat", name: "小舟", angle: -1, spacing: 64, draw: boatLayer },
      { id: "waves", name: "水纹", angle: 1, spacing: 82, draw: waveLayer },
    ],
    timeline: [
      { in: 0.0, out: 7.8 }, { in: 0.35, out: 7.35 },
      { in: 0.75, out: 7.75 }, { in: 1.15, out: 7.55 },
    ],
  },
  {
    id: "crane",
    title: "鹤归松谷",
    english: "CRANE RETURNS",
    mood: "薄雾 · 山麓",
    accent: "CH. 02",
    description: "压低山脊，留白给鹤。让松针与芦苇在两侧轻轻收住。",
    palette: {
      wallTop: "#dfd0ae", wallBottom: "#73806b", glow: "#f4e0ab",
      ink: ["#3a4237", "#30392f", "#242b24", "#505b49"], grain: "#485044",
    },
    layers: [
      { id: "pine", name: "松枝", angle: 0, spacing: 70, draw: pineLayer },
      { id: "ridge", name: "山脊", angle: -3, spacing: 78, draw: ridgeLayer },
      { id: "crane", name: "白鹤", angle: 2, spacing: 50, draw: craneLayer },
      { id: "reed", name: "芦苇", angle: -1, spacing: 86, draw: reedLayer },
    ],
    timeline: [
      { in: 0.0, out: 7.65 }, { in: 0.5, out: 7.9 },
      { in: 0.9, out: 7.45 }, { in: 1.3, out: 7.7 },
    ],
  },
  {
    id: "city",
    title: "灯火归人",
    english: "LAMPLIT RETURN",
    mood: "夜色 · 长街",
    accent: "CH. 03",
    description: "城郭退进夜色，留一轮满月与一盏街灯，照见归家的人。",
    palette: {
      wallTop: "#cbb791", wallBottom: "#6d5542", glow: "#ffd99b",
      ink: ["#302822", "#3f3329", "#211b17", "#4a3727"], grain: "#3d2d23",
    },
    layers: [
      { id: "city", name: "城郭", angle: 0, spacing: 76, draw: skylineLayer },
      { id: "moon", name: "满月", angle: 4, spacing: 62, draw: moonLayer },
      { id: "lamps", name: "灯影", angle: -2, spacing: 54, draw: lampLayer },
      { id: "walker", name: "归人", angle: 1, spacing: 88, draw: walkerLayer },
    ],
    timeline: [
      { in: 0.0, out: 7.9 }, { in: 0.4, out: 7.4 },
      { in: 0.8, out: 7.8 }, { in: 1.15, out: 7.55 },
    ],
  },
];

export function createSceneState(scene) {
  return {
    angles: scene.layers.map((layer) => layer.angle),
    spacings: scene.layers.map((layer) => layer.spacing),
    light: { x: 0.88, y: 0.46, distance: 64, height: 48 },
    timeline: scene.timeline.map((fade) => ({ ...fade })),
    currentTime: 2.8,
    complete: false,
  };
}
