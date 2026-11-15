import { SHOTS, ballState } from './editor-core.mjs';

export const VIEW_W = 960;
export const VIEW_H = 540;
const GROUND_Y = 430;

function drawBackdrop(ctx, timeS) {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, '#101726');
  sky.addColorStop(0.65, '#1d2b45');
  sky.addColorStop(1, '#2c3c57');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // Distant skyline, shared by all cameras so parallax is coherent.
  ctx.fillStyle = 'rgba(8, 14, 26, 0.85)';
  for (let i = 0; i < 14; i += 1) {
    const x = i * 74 - 30;
    const h = 70 + ((i * 53) % 90);
    ctx.fillRect(x, GROUND_Y - h, 48, h);
    ctx.fillStyle = 'rgba(255, 214, 120, 0.5)';
    for (let wy = 0; wy < 3; wy += 1) {
      if ((i + wy) % 2 === 0) ctx.fillRect(x + 10, GROUND_Y - h + 14 + wy * 22, 8, 10);
    }
    ctx.fillStyle = 'rgba(8, 14, 26, 0.85)';
  }

  // Floor with moving grid lines conveying speed/motion.
  ctx.fillStyle = '#20293a';
  ctx.fillRect(0, GROUND_Y, VIEW_W, VIEW_H - GROUND_Y);
  ctx.strokeStyle = 'rgba(120, 170, 255, 0.25)';
  ctx.lineWidth = 2;
  const scroll = (timeS * 90) % 60;
  for (let x = -scroll; x < VIEW_W; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y);
    ctx.lineTo(x - 26, VIEW_H);
    ctx.stroke();
  }
  ctx.beginPath();
 ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(VIEW_W, GROUND_Y);
  ctx.strokeStyle = 'rgba(160, 200, 255, 0.55)';
  ctx.stroke();
}

function drawBall(ctx, state, shotHue) {
  const cx = state.floorX;
  const cy = GROUND_Y - state.height;
  const r = 46;
  const sx = 1 + state.squash * 0.45;
  const sy = 1 - state.squash * 0.38;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(sx, sy);
  const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r);
  grad.addColorStop(0, `hsl(${shotHue} 90% 72%)`);
  grad.addColorStop(1, `hsl(${shotHue} 85% 38%)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // Rotating seam makes the spin readable at every shot size.
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, state.phase * 6, state.phase * 6 + Math.PI * 1.2);
  ctx.stroke();

  // Face: eyes widen on impact, a clear action-peak cue.
  const eyeOpen = 1 - state.squash * 0.7;
  ctx.fillStyle = '#0e1626';
  ctx.beginPath();
  ctx.ellipse(-15, -10, 6, 8 * eyeOpen + 1.5, 0, 0, Math.PI * 2);
  ctx.ellipse(15, -10, 6, 8 * eyeOpen + 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0e1626';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(0, 8, 12, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.restore();

  // Contact shadow shrinks as the ball rises.
  const lift = Math.min(1, state.height / 260);
  ctx.save();
  ctx.globalAlpha = 0.35 * (1 - lift * 0.7);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, GROUND_Y + 6, r * (1.35 - lift * 0.5), 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Render one source shot. The camera centers on the ball and zooms, so the
// same world event reads as wide / medium / close-up framing.
export function renderShot(canvas, shotIndex, timeS) {
  const ctx = canvas.getContext('2d');
  const shot = SHOTS[shotIndex];
  const state = ballState(timeS);
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;

  ctx.save();
  const targetX = state.floorX;
  const targetY = GROUND_Y - Math.min(state.height, 200);
  ctx.translate(VIEW_W / 2, VIEW_H / 2 + 40);
  ctx.scale(shot.zoom, shot.zoom);
  ctx.translate(-targetX, -targetY);
  drawBackdrop(ctx, timeS);
  drawBall(ctx, state, shot.hue);
  ctx.restore();

  // Lens label and safe-area ring, per-shot chrome so the three feeds are
  // visually distinguishable in the source monitors.
  ctx.fillStyle = `hsla(${shot.ringHue} 90% 65% / 0.95)`;
  ctx.fillRect(0, 0, 190, 34);
  ctx.fillStyle = '#0b1220';
  ctx.font = 'bold 20px "Noto Sans SC Subset", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(shot.label, 12, 17);
  ctx.strokeStyle = `hsla(${shot.ringHue} 90% 70% / 0.5)`;
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, VIEW_W - 12, VIEW_H - 12);
}

// Composite an output frame given per-shot weights (hard cut => one weight
// is 1; crossfade => two weights blend). Each source is rendered into its
// own offscreen canvas, then alpha-composited.
export function renderComposite(offscreenCanvases, target, timeS, weights) {
  const ctx = target.getContext('2d');
  target.width = VIEW_W;
  target.height = VIEW_H;
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  weights.forEach((weight, shotIndex) => {
    if (weight <= 0.001) return;
    renderShot(offscreenCanvases[shotIndex], shotIndex, timeS);
    ctx.save();
    ctx.globalAlpha = weight;
    ctx.drawImage(offscreenCanvases[shotIndex], 0, 0);
    ctx.restore();
  });
}

export function makeOffscreenCanvases() {
  return [0, 1, 2].map(() => {
    const canvas = document.createElement('canvas');
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    return canvas;
  });
}
