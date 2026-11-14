import { clamp } from './utils.js';

// 湿地反射：垂直翻转场景、按条带制造水波纹扰动，再叠加灯光拖影
export function paintReflection(ctx, sourceCanvas, sceneRenderer, intensity, time) {
  if (intensity <= 0.01) return;
  const W = sourceCanvas.width;
  const H = sourceCanvas.height;
  const gy = sceneRenderer.groundY();
  const groundH = H - gy;
  if (groundH <= 4) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, gy, W, groundH);
  ctx.clip();

  const sliceH = 3;
  const strength = intensity * 14;
  for (let dy = 0; dy < groundH; dy += sliceH) {
    const dist = dy / groundH;
    // 近处波纹幅度更大
    const wobble =
      Math.sin(dy * 0.12 + time * 2.2) * strength * dist +
      Math.sin(dy * 0.045 + time * 1.1) * strength * 0.5 * dist;
    const srcY = clamp(gy - dy - sliceH, 0, H - 1);
    ctx.globalAlpha = intensity * (0.34 - dist * 0.18);
    ctx.drawImage(
      sourceCanvas,
      0, srcY, W, sliceH + 1,
      wobble, gy + dy, W, sliceH + 1
    );
  }

  // 地面渐变压暗，保留湿润感
  const g = ctx.createLinearGradient(0, gy, 0, H);
  g.addColorStop(0, `rgba(4,8,20,${0.35 * intensity})`);
  g.addColorStop(1, `rgba(2,4,10,${0.75 * intensity})`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, gy, W, groundH);

  // 窗灯垂直拖影
  for (const s of sceneRenderer.lightStreaks) {
    if (s.y < gy - 2) continue;
    const len = (28 + ((s.x * 13) % 26)) * intensity;
    const lg = ctx.createLinearGradient(s.x, s.y, s.x, s.y + len);
    lg.addColorStop(0, s.color.replace('0.95', String(0.5 * intensity)));
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(s.x - 1, s.y, 2, len);
  }
  ctx.restore();
}
