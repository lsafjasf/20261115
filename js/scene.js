import { CANVAS } from "./timeline.js";

const WIDTH = CANVAS.width;
const HEIGHT = CANVAS.height;

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(92831);
const stars = Array.from({ length: 132 }, () => ({
  x: random() * WIDTH,
  y: random() * 405,
  radius: 0.4 + random() * 1.45,
  phase: random() * Math.PI * 2,
  speed: 0.4 + random() * 1.1,
  brightness: 0.3 + random() * 0.68,
}));
const dust = Array.from({ length: 56 }, () => ({
  x: random() * WIDTH,
  y: 350 + random() * 330,
  size: 0.5 + random() * 1.5,
  drift: 0.8 + random() * 2,
  phase: random() * Math.PI * 2,
}));

function rounded(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawSky(context, time) {
  const sky = context.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, "#061018");
  sky.addColorStop(0.36, "#0b2029");
  sky.addColorStop(0.67, "#1c363b");
  sky.addColorStop(1, "#081419");
  context.fillStyle = sky;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  const horizonGlow = context.createRadialGradient(930, 385, 20, 930, 385, 480);
  horizonGlow.addColorStop(0, "rgba(181, 131, 74, 0.27)");
  horizonGlow.addColorStop(0.32, "rgba(115, 98, 73, 0.11)");
  horizonGlow.addColorStop(1, "rgba(8, 20, 25, 0)");
  context.fillStyle = horizonGlow;
  context.fillRect(300, 0, 980, 560);

  drawStars(context, time);
  drawMoon(context, time);
  drawClouds(context, time);
}

function drawStars(context, time) {
  context.save();
  stars.forEach((star) => {
    const twinkle = 0.52 + Math.sin(time * star.speed + star.phase) * 0.18;
    context.globalAlpha = star.brightness * twinkle;
    context.fillStyle = star.radius > 1.2 ? "#f3d7a5" : "#d2e2df";
    context.beginPath();
    context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    context.fill();
  });
  context.restore();
}

function drawMoon(context, time) {
  const pulse = Math.sin(time * 0.14) * 8;
  const glow = context.createRadialGradient(970, 145, 18, 970, 145, 190 + pulse);
  glow.addColorStop(0, "rgba(237, 202, 142, 0.38)");
  glow.addColorStop(0.24, "rgba(213, 170, 111, 0.11)");
  glow.addColorStop(1, "rgba(183, 137, 82, 0)");
  context.fillStyle = glow;
  context.beginPath();
  context.arc(970, 145, 210, 0, Math.PI * 2);
  context.fill();

  context.save();
  context.shadowColor = "rgba(235, 188, 124, 0.42)";
  context.shadowBlur = 35;
  context.fillStyle = "#d9b47d";
  context.beginPath();
  context.arc(970, 145, 43, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.fillStyle = "rgba(74, 75, 64, 0.16)";
  context.beginPath();
  context.arc(958, 135, 10, 0, Math.PI * 2);
  context.arc(984, 155, 6, 0, Math.PI * 2);
  context.arc(952, 160, 4, 0, Math.PI * 2);
  context.fill();
}

function drawClouds(context, time) {
  context.save();
  const clouds = [
    { x: 160, y: 260, width: 430, height: 36, alpha: 0.055, speed: 5 },
    { x: 680, y: 232, width: 560, height: 44, alpha: 0.047, speed: 8 },
    { x: 1040, y: 315, width: 340, height: 28, alpha: 0.038, speed: 3.2 },
  ];

  clouds.forEach((cloud) => {
    const offset = (time * cloud.speed) % (WIDTH + cloud.width + 200);
    const x = ((cloud.x + offset) % (WIDTH + cloud.width + 200)) - cloud.width;
    const gradient = context.createLinearGradient(x, cloud.y, x + cloud.width, cloud.y);
    gradient.addColorStop(0, "rgba(201, 190, 164, 0)");
    gradient.addColorStop(0.35, `rgba(207, 193, 163, ${cloud.alpha})`);
    gradient.addColorStop(0.75, `rgba(207, 193, 163, ${cloud.alpha * 0.72})`);
    gradient.addColorStop(1, "rgba(201, 190, 164, 0)");
    context.fillStyle = gradient;
    rounded(context, x, cloud.y, cloud.width, cloud.height, cloud.height / 2);
    context.fill();
  });
  context.restore();
}

function drawHeadland(context, time) {
  const offset = Math.sin(time * 0.08) * 3;
  context.save();
  context.translate(offset, 0);

  context.fillStyle = "#081217";
  context.beginPath();
  context.moveTo(-40, 459);
  context.bezierCurveTo(145, 424, 267, 445, 372, 467);
  context.lineTo(386, 535);
  context.lineTo(-40, 552);
  context.closePath();
  context.fill();

  context.fillStyle = "#0b171b";
  context.beginPath();
  context.moveTo(50, 467);
  context.bezierCurveTo(150, 454, 213, 464, 269, 478);
  context.lineTo(250, 531);
  context.lineTo(45, 540);
  context.closePath();
  context.fill();
  context.restore();
}

function drawLighthouse(context, time) {
  const x = 242;
  const baseY = 472;
  const topY = 257;

  context.save();
  context.fillStyle = "#0a1216";
  context.beginPath();
  context.moveTo(x - 32, baseY);
  context.lineTo(x - 20, topY + 34);
  context.lineTo(x + 18, topY + 34);
  context.lineTo(x + 38, baseY);
  context.closePath();
  context.fill();

  context.strokeStyle = "rgba(177, 150, 108, 0.22)";
  context.lineWidth = 15;
  context.beginPath();
  context.moveTo(x - 23, 416);
  context.lineTo(x + 24, 390);
  context.stroke();

  context.fillStyle = "#111b1d";
  rounded(context, x - 24, topY, 48, 43, 5);
  context.fill();
  context.fillStyle = "#e2ae62";
  context.shadowColor = "rgba(238, 177, 92, 0.68)";
  context.shadowBlur = 22;
  rounded(context, x - 15, topY + 10, 30, 22, 3);
  context.fill();
  context.shadowBlur = 0;

  context.fillStyle = "#0b1317";
  context.beginPath();
  context.moveTo(x - 27, topY);
  context.lineTo(x, topY - 22);
  context.lineTo(x + 27, topY);
  context.closePath();
  context.fill();

  context.strokeStyle = "rgba(215, 174, 113, 0.14)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x - 2, topY + 38);
  context.lineTo(x - 3, baseY);
  context.stroke();
  context.restore();
}

function drawBeam(context, time) {
  const beamAngle = -0.16 + Math.sin(time * 0.16) * 0.14;
  context.save();
  context.translate(242, 278);
  context.rotate(beamAngle);
  const beam = context.createLinearGradient(0, 0, 710, 0);
  beam.addColorStop(0, "rgba(238, 190, 112, 0.22)");
  beam.addColorStop(0.28, "rgba(219, 176, 112, 0.075)");
  beam.addColorStop(1, "rgba(219, 176, 112, 0)");
  context.fillStyle = beam;
  context.beginPath();
  context.moveTo(10, 8);
  context.lineTo(710, -104);
  context.lineTo(710, 132);
  context.closePath();
  context.fill();
  context.restore();
}

function drawSea(context, time) {
  const sea = context.createLinearGradient(0, 428, 0, HEIGHT);
  sea.addColorStop(0, "rgba(21, 45, 50, 0.86)");
  sea.addColorStop(0.44, "#10252b");
  sea.addColorStop(1, "#061115");
  context.fillStyle = sea;
  context.fillRect(0, 428, WIDTH, HEIGHT - 428);

  const reflection = context.createLinearGradient(885, 0, 1050, 0);
  reflection.addColorStop(0, "rgba(203, 157, 93, 0)");
  reflection.addColorStop(0.46, "rgba(210, 160, 92, 0.17)");
  reflection.addColorStop(1, "rgba(203, 157, 93, 0)");
  context.fillStyle = reflection;
  context.fillRect(870, 435, 190, 285);

  context.save();
  for (let index = 0; index < 26; index += 1) {
    const y = 452 + index * 10.2;
    const shift = Math.sin(time * (0.22 + index * 0.007) + index * 0.73) * 31;
    const width = 102 + index * 19 + Math.sin(time * 0.18 + index) * 18;
    const x = (index * 173 + shift + 70) % (WIDTH + width) - width;
    context.globalAlpha = 0.08 + (index % 6) * 0.013;
    context.strokeStyle = index < 10 ? "#c0a477" : "#87a9a8";
    context.lineWidth = index < 8 ? 1.3 : 0.8;
    context.beginPath();
    context.moveTo(x, y);
    context.bezierCurveTo(x + width * 0.24, y - 2, x + width * 0.66, y + 2, x + width, y);
    context.stroke();
  }
  context.restore();
}

function drawForeground(context, time) {
  context.save();
  const horizon = context.createLinearGradient(0, 494, 0, HEIGHT);
  horizon.addColorStop(0, "rgba(4, 12, 15, 0)");
  horizon.addColorStop(1, "rgba(3, 8, 10, 0.84)");
  context.fillStyle = horizon;
  context.fillRect(0, 490, WIDTH, HEIGHT - 490);

  dust.forEach((particle) => {
    const x = particle.x + Math.sin(time * 0.09 + particle.phase) * 35 * particle.drift;
    const y = particle.y + Math.cos(time * 0.06 + particle.phase) * 12;
    context.globalAlpha = 0.08 + Math.sin(time * 0.7 + particle.phase) * 0.035;
    context.fillStyle = "#d5ba8e";
    context.beginPath();
    context.arc(x, y, particle.size, 0, Math.PI * 2);
    context.fill();
  });
  context.restore();
}

function drawGrain(context, time) {
  const frame = Math.floor(time * CANVAS.fps);
  const noise = mulberry32(frame * 73 + 11);
  context.save();
  for (let index = 0; index < 300; index += 1) {
    const x = noise() * WIDTH;
    const y = noise() * HEIGHT;
    const alpha = 0.018 + noise() * 0.032;
    context.fillStyle = noise() > 0.5 ? `rgba(255, 244, 222, ${alpha})` : `rgba(0, 0, 0, ${alpha * 1.4})`;
    context.fillRect(x, y, 1.1, 1.1);
  }
  context.restore();
}

function drawVignette(context) {
  const vignette = context.createRadialGradient(
    WIDTH / 2,
    HEIGHT / 2,
    HEIGHT * 0.25,
    WIDTH / 2,
    HEIGHT / 2,
    HEIGHT * 0.76
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(0.72, "rgba(0, 0, 0, 0.13)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.48)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, WIDTH, HEIGHT);
}

export function drawScene(context, time) {
  context.save();
  drawSky(context, time);
  drawSea(context, time);
  drawHeadland(context, time);
  drawBeam(context, time);
  drawLighthouse(context, time);
  drawForeground(context, time);
  drawVignette(context);
  drawGrain(context, time);
  context.restore();
}

function edgeOpacity(centerY) {
  const ramp = 74;
  const top = Math.min(1, Math.max(0, centerY / ramp));
  const bottom = Math.min(1, Math.max(0, (HEIGHT - centerY) / ramp));
  return Math.min(top, bottom);
}

export function drawCredits(context, geometry, scroll, config) {
  const contentTop = geometry.initialTop - scroll;
  const fontSize = config.fontSize ?? 38;
  context.save();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `400 ${fontSize}px "RC Serif", "Noto Serif CJK SC", "Songti SC", "STSong", serif`;
  context.fillStyle = "#f4eee1";
  context.shadowColor = "rgba(0, 0, 0, 0.88)";
  context.shadowBlur = 18;
  context.shadowOffsetY = 2;

  geometry.rows.forEach((row) => {
    if (row.blank || !row.text) return;
    const centerY = contentTop + row.top + geometry.lineHeight / 2;
    if (centerY < -geometry.lineHeight || centerY > HEIGHT + geometry.lineHeight) return;
    const opacity = edgeOpacity(centerY);
    context.globalAlpha = opacity;
    context.fillText(row.text, WIDTH / 2, centerY + 2);
  });

  context.restore();
}

export function drawBackdropFade(context, amount) {
  if (amount <= 0) return;
  context.save();
  context.globalAlpha = Math.min(1, amount);
  context.fillStyle = "#050708";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.restore();
}

export function drawSafeFrame(context, visible) {
  if (!visible) return;
  const marginX = WIDTH * 0.05;
  const marginY = HEIGHT * 0.05;
  context.save();
  context.strokeStyle = "rgba(232, 177, 95, 0.3)";
  context.lineWidth = 1;
  context.setLineDash([5, 7]);
  context.strokeRect(marginX, marginY, WIDTH - marginX * 2, HEIGHT - marginY * 2);
  context.restore();
}
