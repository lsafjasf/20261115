// Canvas renderer shared by the live board and the replay board.

import { CONFIG } from './engine.js';

export function renderBoard(canvas, state, options = {}) {
  const ctx = canvas.getContext('2d');
  const { divergenceTick = null, markDivergence = false, flashEvents = [] } = options;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Grid background.
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  for (let x = 40; x < CONFIG.fieldWidth; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CONFIG.fieldHeight);
    ctx.stroke();
  }
  for (let y = 40; y < CONFIG.fieldHeight; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CONFIG.fieldWidth, y);
    ctx.stroke();
  }

  // Target with a shrinking TTL ring.
  if (state.target) {
    const { x, y, bornTick, ttlTicks } = state.target;
    const age = state.tick - bornTick;
    const lifeLeft = Math.max(0, 1 - age / ttlTicks);

    ctx.beginPath();
    ctx.arc(x, y, CONFIG.targetRadius, 0, Math.PI * 2);
    ctx.fillStyle = markDivergence ? 'rgba(255,93,108,0.35)' : 'rgba(87,208,255,0.22)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = markDivergence ? '#ff5d6c' : '#57d0ff';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, CONFIG.targetRadius * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = markDivergence ? '#ff5d6c' : '#57d0ff';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, CONFIG.targetRadius + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * lifeLeft);
    ctx.strokeStyle = 'rgba(255,200,87,0.8)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Event flashes from the latest tick.
  for (const evt of flashEvents) {
    if (evt.type === 'hit' || evt.type === 'miss') {
      ctx.beginPath();
      ctx.arc(evt.x, evt.y, CONFIG.targetRadius, 0, Math.PI * 2);
      ctx.strokeStyle = evt.type === 'hit' ? '#46d18d' : '#ff5d6c';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  // Top-left tick / score overlay.
  ctx.fillStyle = '#8a97ad';
  ctx.font = '13px monospace';
  ctx.fillText(`tick ${state.tick}/${CONFIG.totalTicks}`, 10, 20);
  ctx.fillText(`score ${state.score}`, 10, 38);

  if (state.status === 'finished') {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e6ebf5';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('对局结束', canvas.width / 2, canvas.height / 2 - 8);
    ctx.font = '16px monospace';
    ctx.fillText(`score ${state.score}`, canvas.width / 2, canvas.height / 2 + 22);
    ctx.textAlign = 'left';
  }

  if (markDivergence && divergenceTick !== null) {
    ctx.fillStyle = '#ff5d6c';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(`⚠ 首次分叉 tick ${divergenceTick}`, 10, canvas.height - 16);
  }
}
