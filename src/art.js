import { HEIGHT, WIDTH } from "./scenes.js";

function makeCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  return canvas;
}

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function poly(ctx, points, fill) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
}

function drawGlow(ctx, x, y, radius, inner, outer) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, inner);
  glow.addColorStop(0.35, inner);
  glow.addColorStop(1, outer);
  ctx.fillStyle = glow;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function drawConifer(ctx, x, baseY, height, spread, color, alpha = 1, lean = 0) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;

  const trunkWidth = Math.max(3, spread * 0.09);
  poly(
    ctx,
    [
      [x - trunkWidth * 0.7, baseY],
      [x + lean * 0.2, baseY - height * 0.82],
      [x + trunkWidth * 0.7, baseY],
    ],
    color,
  );

  const tiers = 7;
  for (let i = 0; i < tiers; i += 1) {
    const ratio = i / (tiers - 1);
    const y = baseY - height * (0.98 - ratio * 0.78);
    const half = spread * (0.06 + ratio * 0.72);
    const offset = lean * (1 - ratio);
    const droop = height * 0.035;
    poly(
      ctx,
      [
        [x + offset, y - height * 0.08],
        [x + offset - half * 0.62, y + droop * 0.25],
        [x + offset - half, y + droop],
        [x + offset - half * 0.46, y + droop * 0.2],
        [x + offset + half * 0.46, y + droop * 0.32],
        [x + offset + half, y + droop],
        [x + offset + half * 0.64, y + droop * 0.18],
      ],
      color,
    );
  }
  ctx.restore();
}

function drawGrain(ctx, seed, alpha, width = WIDTH, height = HEIGHT) {
  const random = seeded(seed);
  ctx.save();
  for (let i = 0; i < 900; i += 1) {
    const x = random() * width;
    const y = random() * height;
    const size = 0.4 + random() * 1.4;
    ctx.fillStyle = `rgba(240, 238, 214, ${alpha * random()})`;
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

function mountain(ctx, points, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  poly(ctx, points, color);
  ctx.restore();
}

function drawMistBand(ctx, y, height, alpha, color = "220, 226, 207") {
  const gradient = ctx.createLinearGradient(0, y - height, 0, y + height);
  gradient.addColorStop(0, `rgba(${color}, 0)`);
  gradient.addColorStop(0.5, `rgba(${color}, ${alpha})`);
  gradient.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, y - height, WIDTH, height * 2);
}

function groveBackground() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, "#112b2d");
  sky.addColorStop(0.42, "#385652");
  sky.addColorStop(0.7, "#93aa96");
  sky.addColorStop(1, "#d5c49d");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawGlow(ctx, 948, 218, 390, "rgba(255, 224, 155, 0.44)", "rgba(255, 224, 155, 0)");
  const sun = ctx.createRadialGradient(945, 218, 0, 945, 218, 86);
  sun.addColorStop(0, "rgba(255, 245, 200, 0.92)");
  sun.addColorStop(0.42, "rgba(250, 218, 147, 0.68)");
  sun.addColorStop(1, "rgba(250, 218, 147, 0)");
  ctx.fillStyle = sun;
  ctx.fillRect(840, 112, 210, 210);

  drawMistBand(ctx, 410, 160, 0.2, "209, 219, 200");
  drawMistBand(ctx, 505, 100, 0.36, "215, 221, 197");

  mountain(
    ctx,
    [
      [0, 510],
      [150, 385],
      [305, 470],
      [480, 335],
      [690, 460],
      [860, 372],
      [1010, 455],
      [1180, 360],
      [1280, 420],
      [1280, 590],
      [0, 590],
    ],
    "#49685f",
    0.7,
  );
  mountain(
    ctx,
    [
      [0, 552],
      [160, 474],
      [330, 538],
      [505, 440],
      [665, 530],
      [855, 458],
      [1030, 530],
      [1220, 452],
      [1280, 490],
      [1280, 640],
      [0, 640],
    ],
    "#35564d",
    0.82,
  );

  const random = seeded(91);
  for (let i = 0; i < 24; i += 1) {
    const x = random() * WIDTH;
    const base = 570 + random() * 38;
    drawConifer(ctx, x, base, 60 + random() * 110, 13 + random() * 17, "#29483f", 0.48);
  }
  drawMistBand(ctx, 596, 90, 0.26, "212, 220, 200");
  drawGrain(ctx, 551, 0.11);
  return canvas;
}

function groveMidground() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  const hill = ctx.createLinearGradient(0, 460, 0, HEIGHT);
  hill.addColorStop(0, "rgba(39, 67, 57, 0)");
  hill.addColorStop(0.25, "rgba(26, 53, 44, 0.72)");
  hill.addColorStop(1, "rgba(17, 38, 33, 0.94)");
  ctx.fillStyle = hill;
  ctx.fillRect(0, 460, WIDTH, HEIGHT - 460);

  const random = seeded(311);
  const trees = [
    [60, 748, 560, 155],
    [210, 690, 430, 126],
    [390, 735, 510, 145],
    [810, 730, 490, 150],
    [1010, 690, 405, 130],
    [1180, 752, 570, 180],
  ];
  trees.forEach(([x, y, height, spread], index) => {
    drawConifer(ctx, x, y, height, spread, index % 2 ? "#16352c" : "#1a3b31", 0.72);
  });
  for (let i = 0; i < 13; i += 1) {
    const x = 280 + random() * 700;
    drawConifer(ctx, x, 660 + random() * 60, 100 + random() * 150, 24 + random() * 22, "#1b3b31", 0.4);
  }

  drawMistBand(ctx, 560, 90, 0.18, "201, 213, 190");
  drawGrain(ctx, 892, 0.08);
  return canvas;
}

function cubicAt(a, b, c, d, t) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

function drawNeedleTuft(ctx, x, y, length, spread, angle, color, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.globalAlpha *= 0.28;
  ctx.beginPath();
  ctx.ellipse(0, length * 0.27, length * 0.34, length * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha /= 0.28;
  const needles = 17;
  for (let i = 0; i < needles; i += 1) {
    const ratio = i / (needles - 1) - 0.5;
    const bladeAngle = ratio * spread;
    const bladeLength = length * (0.72 + (1 - Math.abs(ratio)) * 0.4);
    const tipX = Math.sin(bladeAngle) * bladeLength;
    const tipY = -Math.cos(bladeAngle) * bladeLength;
    ctx.beginPath();
    ctx.moveTo(-2.3, 1.5);
    ctx.lineTo(tipX - Math.cos(bladeAngle) * 2.4, tipY + Math.sin(bladeAngle) * 2.4);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tipX + Math.cos(bladeAngle) * 2.4, tipY - Math.sin(bladeAngle) * 2.4);
    ctx.lineTo(2.3, 1.5);
    ctx.fill();
  }
  ctx.restore();
}

function drawBough(ctx, start, controlA, controlB, end, width, color, seed) {
  const random = seeded(seed);
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  const joints = [];
  for (let segment = 0; segment < 8; segment += 1) {
    const t0 = segment / 8;
    const t1 = (segment + 1) / 8;
    ctx.lineWidth = width * (1 - t0 * 0.72);
    ctx.beginPath();
    ctx.moveTo(
      cubicAt(start[0], controlA[0], controlB[0], end[0], t0),
      cubicAt(start[1], controlA[1], controlB[1], end[1], t0),
    );
    ctx.lineTo(
      cubicAt(start[0], controlA[0], controlB[0], end[0], t1),
      cubicAt(start[1], controlA[1], controlB[1], end[1], t1),
    );
    ctx.stroke();
    joints.push([
      cubicAt(start[0], controlA[0], controlB[0], end[0], t0),
      cubicAt(start[1], controlA[1], controlB[1], end[1], t0),
    ]);
  }
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "#bdc2a1";
  ctx.lineWidth = Math.max(1, width * 0.07);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1] - width * 0.18);
  ctx.bezierCurveTo(
    controlA[0],
    controlA[1] - width * 0.18,
    controlB[0],
    controlB[1] - width * 0.18,
    end[0],
    end[1] - width * 0.1,
  );
  ctx.stroke();
  ctx.globalAlpha = 1;
  joints.forEach(([x, y], index) => {
    if (index === 0) return;
    const tuftLength = width * (1.55 + random() * 1.05) + 10;
    [-1, 1].forEach((side) => {
      drawNeedleTuft(
        ctx,
        x + side * width * 0.1,
        y + width * 0.1,
        tuftLength,
        1.55 + random() * 0.45,
        Math.PI + side * (0.3 + random() * 0.4),
        random() > 0.55 ? "#10271b" : "#091a13",
        0.78,
      );
    });
  });
  drawNeedleTuft(ctx, end[0], end[1], width * 2.1, 1.8, Math.PI - 0.35, "#0c2117", 0.7);
  ctx.restore();
}

function groveForeground() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  const random = seeded(731);

  drawConifer(ctx, 172, 922, 1030, 370, "#06100c", 1, 5);
  drawConifer(ctx, 352, 846, 705, 280, "#07140f", 0.76, -4);
  drawConifer(ctx, 1258, 866, 748, 278, "#07120e", 0.9, -3);
  drawConifer(ctx, 1138, 816, 515, 208, "#081611", 0.72, 2);

  const ground = ctx.createLinearGradient(0, 610, 0, HEIGHT);
  ground.addColorStop(0, "rgba(7, 17, 13, 0)");
  ground.addColorStop(0.4, "rgba(5, 14, 11, 0.72)");
  ground.addColorStop(1, "#030a08");
  ctx.fillStyle = ground;
  ctx.fillRect(0, 600, WIDTH, 120);

  ctx.fillStyle = "rgba(6, 16, 12, 0.88)";
  poly(
    ctx,
    [
      [760, HEIGHT],
      [835, 659],
      [958, 631],
      [1090, 663],
      [1185, 702],
      [1280, 720],
      [1280, HEIGHT],
    ],
  );
  ctx.strokeStyle = "rgba(132, 142, 109, 0.16)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(852, 674);
  ctx.quadraticCurveTo(986, 638, 1130, 677);
  ctx.stroke();

  for (let i = 0; i < 48; i += 1) {
    const x = random() * WIDTH;
    const h = 20 + random() * 94;
    ctx.strokeStyle = `rgba(11, 29, 20, ${0.35 + random() * 0.42})`;
    ctx.lineWidth = 1 + random() * 2;
    ctx.beginPath();
    ctx.moveTo(x, HEIGHT);
    ctx.quadraticCurveTo(x + 8, HEIGHT - h * 0.65, x + (random() - 0.5) * 39, HEIGHT - h);
    ctx.stroke();
  }
  drawGrain(ctx, 1702, 0.06);
  return canvas;
}

export function buildGroveArt() {
  return {
    background: groveBackground(),
    midground: groveMidground(),
    foreground: groveForeground(),
  };
}

function harborBackground() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, "#07101b");
  sky.addColorStop(0.45, "#142b3e");
  sky.addColorStop(0.68, "#31515e");
  sky.addColorStop(1, "#72817b");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const random = seeded(207);
  for (let i = 0; i < 210; i += 1) {
    const x = random() * WIDTH;
    const y = 20 + random() * 420;
    const radius = 0.4 + random() * 1.9;
    const alpha = 0.14 + random() * 0.58;
    ctx.fillStyle = `rgba(205, 231, 226, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  drawGlow(ctx, 980, 217, 430, "rgba(178, 217, 205, 0.13)", "rgba(178, 217, 205, 0)");
  const moonGlow = ctx.createRadialGradient(977, 213, 0, 977, 213, 92);
  moonGlow.addColorStop(0, "rgba(230, 237, 214, 0.96)");
  moonGlow.addColorStop(0.62, "rgba(211, 226, 206, 0.84)");
  moonGlow.addColorStop(1, "rgba(200, 220, 205, 0)");
  ctx.fillStyle = moonGlow;
  ctx.fillRect(880, 112, 194, 194);

  const cityGradient = ctx.createLinearGradient(0, 440, 0, 530);
  cityGradient.addColorStop(0, "#122a34");
  cityGradient.addColorStop(1, "#0a1c25");
  ctx.fillStyle = cityGradient;
  ctx.fillRect(0, 432, WIDTH, 100);

  const buildings = [
    [20, 437, 64, 88], [92, 449, 42, 70], [144, 454, 95, 58],
    [250, 426, 52, 98], [309, 450, 77, 69], [394, 438, 48, 84],
    [449, 460, 105, 54], [568, 430, 70, 91], [650, 448, 38, 67],
    [700, 455, 116, 60], [830, 441, 61, 80], [902, 454, 82, 64],
    [995, 432, 48, 88], [1050, 446, 88, 72], [1150, 450, 51, 68],
    [1210, 432, 66, 95],
  ];
  const cityRandom = seeded(998);
  buildings.forEach(([x, y, w, h], index) => {
    ctx.fillStyle = index % 2 ? "#102630" : "#0c222d";
    ctx.fillRect(x, y, w, h);
    for (let row = 0; row < Math.floor(h / 12); row += 1) {
      for (let col = 0; col < Math.floor(w / 12); col += 1) {
        if (cityRandom() > 0.54) {
          const light = cityRandom() > 0.2 ? "207, 166, 91" : "104, 185, 188";
          ctx.fillStyle = `rgba(${light}, ${0.28 + cityRandom() * 0.54})`;
          ctx.fillRect(x + 5 + col * 12, y + 7 + row * 12, 2.2, 3.4);
        }
      }
    }
  });
  drawMistBand(ctx, 469, 88, 0.22, "173, 195, 185");
  drawGrain(ctx, 3004, 0.1);
  return canvas;
}

function harborMidground() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  const random = seeded(405);

  const water = ctx.createLinearGradient(0, 450, 0, HEIGHT);
  water.addColorStop(0, "rgba(27, 54, 63, 0.52)");
  water.addColorStop(0.26, "rgba(13, 35, 45, 0.8)");
  water.addColorStop(1, "rgba(5, 18, 26, 0.96)");
  ctx.fillStyle = water;
  ctx.fillRect(0, 450, WIDTH, HEIGHT - 450);

  for (let i = 0; i < 70; i += 1) {
    const y = 470 + random() * 235;
    const x = random() * WIDTH;
    const width = 12 + random() * 128;
    ctx.strokeStyle = `rgba(144, 186, 181, ${0.03 + random() * 0.13})`;
    ctx.lineWidth = 1 + random() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y + (random() - 0.5) * 2);
    ctx.stroke();
  }

  const reflection = ctx.createLinearGradient(965, 0, 965, 0);
  reflection.addColorStop(0, "rgba(214, 225, 193, 0.14)");
  reflection.addColorStop(1, "rgba(214, 225, 193, 0)");
  ctx.fillStyle = reflection;
  for (let i = 0; i < 16; i += 1) {
    ctx.globalAlpha = 0.3 + random() * 0.45;
    ctx.fillRect(940 - random() * 40, 475 + i * 15, 25 + random() * 65, 1.3);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(8, 21, 27, 0.9)";
  poly(
    ctx,
    [
      [0, 558],
      [188, 533],
      [370, 540],
      [536, 550],
      [705, 536],
      [890, 546],
      [1050, 532],
      [1280, 545],
      [1280, 585],
      [0, 585],
    ],
  );

  const boat = (x, y, scale, sail) => {
    ctx.fillStyle = "rgba(5, 15, 20, 0.94)";
    ctx.beginPath();
    ctx.moveTo(x - 46 * scale, y);
    ctx.quadraticCurveTo(x, y + 15 * scale, x + 48 * scale, y);
    ctx.lineTo(x + 35 * scale, y - 9 * scale);
    ctx.lineTo(x - 33 * scale, y - 8 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(10, 23, 28, 0.85)";
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(x, y - 9 * scale);
    ctx.lineTo(x, y - 74 * scale);
    ctx.lineTo(x + (sail > 0 ? 44 : -38) * scale, y - 33 * scale);
    ctx.lineTo(x, y - 33 * scale);
    ctx.stroke();
    ctx.fillStyle = "rgba(195, 145, 77, 0.7)";
    ctx.fillRect(x + 5 * scale, y - 14 * scale, 2, 2);
  };
  boat(530, 520, 1.2, 1);
  boat(1135, 532, 0.74, -1);

  ctx.save();
  ctx.translate(960, 0);
  ctx.fillStyle = "#0a1b23";
  poly(ctx, [[-45, 584], [-25, 246], [24, 246], [44, 584]], "#102832");
  ctx.fillStyle = "rgba(185, 191, 169, 0.6)";
  poly(ctx, [[-36, 518], [34, 518], [30, 485], [-32, 485]]);
  poly(ctx, [[-28, 377], [27, 377], [24, 347], [-25, 347]]);
  ctx.fillStyle = "#09171d";
  ctx.fillRect(-55, 574, 115, 18);
  ctx.fillStyle = "#d2c590";
  ctx.fillRect(-17, 236, 34, 12);
  drawGlow(ctx, 0, 240, 125, "rgba(255, 220, 143, 0.52)", "rgba(255, 220, 143, 0)");
  ctx.restore();

  drawMistBand(ctx, 588, 100, 0.16, "161, 187, 179");
  drawGrain(ctx, 8261, 0.08);
  return canvas;
}

function harborForeground() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  const random = seeded(612);

  const post = ctx.createLinearGradient(194, 0, 318, 0);
  post.addColorStop(0, "#050c0e");
  post.addColorStop(0.38, "#13211f");
  post.addColorStop(0.72, "#26322e");
  post.addColorStop(1, "#060c0d");
  ctx.fillStyle = post;
  poly(
    ctx,
    [
      [202, HEIGHT],
      [214, 558],
      [238, 520],
      [296, 548],
      [306, HEIGHT],
    ],
  );
  ctx.fillStyle = "rgba(137, 154, 137, 0.16)";
  ctx.fillRect(226, 570, 4, 130);
  ctx.fillRect(259, 560, 3, 145);

  ctx.strokeStyle = "rgba(4, 11, 12, 0.92)";
  ctx.lineWidth = 15;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(286, 548);
  ctx.bezierCurveTo(520, 690, 720, 565, 1010, 505);
  ctx.stroke();
  ctx.strokeStyle = "rgba(151, 145, 107, 0.28)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(292, 544);
  ctx.bezierCurveTo(520, 682, 720, 561, 1007, 500);
  ctx.stroke();

  ctx.fillStyle = "rgba(5, 12, 13, 0.94)";
  ctx.fillRect(0, 658, WIDTH, 62);
  for (let i = 0; i < 5; i += 1) {
    ctx.fillRect(44 + i * 275, 605, 24, 115);
    ctx.fillRect(33 + i * 275, 605, 66, 12);
  }
  ctx.strokeStyle = "rgba(5, 12, 13, 0.94)";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(0, 622);
  ctx.lineTo(WIDTH, 622);
  ctx.stroke();

  for (let i = 0; i < 17; i += 1) {
    const x = 855 + random() * 430;
    const y = 370 + random() * 195;
    const radius = 5 + random() * 24;
    const warm = random() > 0.42;
    ctx.strokeStyle = warm ? "rgba(216, 166, 88, 0.2)" : "rgba(112, 183, 187, 0.18)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(3, 9, 11, 0.9)";
  poly(
    ctx,
    [
      [0, 720],
      [0, 670],
      [180, 658],
      [390, 687],
      [580, 670],
      [850, 710],
      [1280, 685],
      [1280, 720],
    ],
  );
  drawGrain(ctx, 5432, 0.06);
  return canvas;
}

export function buildHarborArt() {
  return {
    background: harborBackground(),
    midground: harborMidground(),
    foreground: harborForeground(),
  };
}
