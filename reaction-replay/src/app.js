import { CONFIG, createEngine, snapshotState } from './engine.js';
import { createRecorder, replayAndVerify, verifyHashChain, emptyInput } from './recorder.js';
import { decideInput } from './bot.js';
import { createFeedback } from './audio.js';
import { renderBoard } from './renderer.js';

const $ = (id) => document.getElementById(id);
const liveCanvas = $('liveCanvas');
const replayCanvas = $('replayCanvas');
const feedback = createFeedback();

let recorder = null;
let gameLog = null;
let activeLog = null;
let mode = 'idle'; // idle | live | replaying
let pendingClicks = [];
let rafId = null;
let lastStepAt = 0;
let autoPlay = true;

function logLine(text) {
  const out = $('logOut');
  out.textContent = `${new Date().toLocaleTimeString()}  ${text}\n${out.textContent}`;
}

function setBadge(kind, text) {
  const badge = $('verifyBadge');
  badge.className = `badge ${kind}`;
  badge.textContent = text;
}

function updateHud(state, hash) {
  $('tickVal').textContent = `${state.tick} / ${CONFIG.totalTicks}`;
  $('scoreVal').textContent = state.score;
  $('hmVal').textContent = `${state.hits} / ${state.misses}`;
  $('hashVal').textContent = hash ? `0x${hash.toString(16)}` : '—';
}

function consumeClick() {
  if (pendingClicks.length === 0) return emptyInput();
  const click = pendingClicks.shift();
  return { clicked: true, x: click.x, y: click.y };
}

liveCanvas.addEventListener('pointerdown', (event) => {
  feedback.unlock();
  if (mode !== 'live') return;
  autoPlay = false; // any manual click switches the session to manual control
  const rect = liveCanvas.getBoundingClientRect();
  const x = Math.round(((event.clientX - rect.left) / rect.width) * CONFIG.fieldWidth);
  const y = Math.round(((event.clientY - rect.top) / rect.height) * CONFIG.fieldHeight);
  pendingClicks.push({ x, y });
});

function playEventSounds(events) {
  for (const evt of events) {
    if (evt.type === 'hit' || evt.type === 'spawn') feedback.hit();
    else if (evt.type === 'miss') feedback.miss();
    else if (evt.type === 'expire') feedback.expire();
  }
}

function startGame() {
  cancelAnimationFrame(rafId);
  const seed = (Date.now() ^ 0x9e3779b9) >>> 0;
  recorder = createRecorder(seed);
  gameLog = null;
  activeLog = null;
  pendingClicks = [];
  autoPlay = true;
  mode = 'live';
  lastStepAt = 0;
  $('replayBtn').disabled = true;
  $('tamperBtn').disabled = true;
  $('verifyBtn').disabled = true;
  $('divergenceInfo').textContent = '—';
  replayCanvas.classList.remove('diverged');
  renderBoard(replayCanvas, recorder.state);
  setBadge('idle', '对局进行中');
  logLine(`开始新对局，seed=${seed}（自动模式；点击左画布可接管手动操作）`);
  rafId = requestAnimationFrame(loop);
}

function loop(timestamp) {
  if (mode !== 'live') return;
  if (!lastStepAt) lastStepAt = timestamp;
  const elapsed = timestamp - lastStepAt;

  if (elapsed >= CONFIG.tickMs) {
    lastStepAt = timestamp - (elapsed % CONFIG.tickMs);
    const input = autoPlay ? decideInput(recorder.state) : consumeClick();
    const { events, state } = recorder.recordTick(input);
    playEventSounds(events);
    renderBoard(liveCanvas, state, { flashEvents: events });
    updateHud(state, null);

    if (recorder.finished) {
      finishLiveGame();
      return;
    }
  }
  rafId = requestAnimationFrame(loop);
}

function finishLiveGame() {
  gameLog = recorder.finish();
  activeLog = gameLog;
  mode = 'idle';
  feedback.finish();
  const s = gameLog.summary;
  $('hashVal').textContent = `0x${s.lastHash.toString(16)}`;
  $('replayBtn').disabled = false;
  $('tamperBtn').disabled = false;
  $('verifyBtn').disabled = false;
  setBadge('idle', '对局完成 · 待校验');
  logLine(`对局完成：${s.finalTick} ticks，得分 ${s.finalScore}，命中 ${s.hits}，失误 ${s.misses}`);
  logLine(`日志含 ${gameLog.entries.length} 条逐 tick 记录，链末哈希 0x${s.lastHash.toString(16)}`);
}

function runReplay(tamperedLog, label) {
  const log = tamperedLog || activeLog || gameLog;
  activeLog = log;
  mode = 'replaying';
  setBadge('idle', '重放中…');
  const engine = createEngine(log.seed);
  const report = replayAndVerify(log);
  const firstDiv = report.firstDivergence;

  let index = 0;
  const replayLoop = () => {
    if (index >= log.entries.length) {
      mode = 'idle';
      presentReport(report, label);
      return;
    }
    const entry = log.entries[index];
    engine.step(entry.input || emptyInput());
    const replayed = snapshotState(engine.state, engine.rng.state);
    const divergedHere = firstDiv && entry.tick === firstDiv.tick;
    renderBoard(replayCanvas, replayed, {
      markDivergence: !!firstDiv && entry.tick >= firstDiv.tick,
      divergenceTick: firstDiv ? firstDiv.tick : null,
    });
    if (divergedHere) {
      feedback.alarm();
      replayCanvas.classList.add('diverged');
      $('divergenceInfo').textContent =
        `首次分叉 @ tick ${firstDiv.tick}（${firstDiv.field}）`;
    }
    index += 1;
    setTimeout(replayLoop, CONFIG.tickMs);
  };
  replayLoop();
  return report;
}

function presentReport(report, label) {
  if (report.faithful) {
    setBadge('good', `${label}：校验通过`);
    $('divergenceInfo').textContent = '无分叉，重放终态与得分摘要一致';
    logLine(`${label}：哈希链 ${report.hashChain.intact ? '完整' : '损坏'}，摘要${report.summaryMatches ? '一致' : '不一致'}，无分叉`);
  } else {
    setBadge('bad', `${label}：检测到篡改/分叉`);
    const d = report.firstDivergence;
    if (d) {
      $('divergenceInfo').textContent =
        `首次分叉 @ tick ${d.tick}（${d.field === 'state' ? '游戏状态' : d.field}）`;
    }
    logLine(`${label}：哈希链首个损坏 tick=${report.hashChain.firstBadTick}，摘要${report.summaryMatches ? '一致' : '不符'}`);
    if (d && d.field === 'state') {
      logLine(`  记录值 score=${d.expected.score} rng=${d.expected.rng} ↔ 重放值 score=${d.actual.score} rng=${d.actual.rng}`);
    }
  }
}

function tamperLog() {
  if (!gameLog) return;
  const tampered = structuredClone(gameLog);
  const index = Math.floor(tampered.entries.length / 3);
  const tick = tampered.entries[index].tick;
  tampered.entries[index].input.clicked = true;
  tampered.entries[index].input.x = 40;
  tampered.entries[index].input.y = 40;
  logLine(`篡改 tick ${tick} 的输入记录：clicked=true, (x,y)=(40,40)`);
  replayCanvas.classList.remove('diverged');
  runReplay(tampered, '篡改日志重放');
}

function verifyCurrent() {
  if (!gameLog) return;
  replayCanvas.classList.remove('diverged');
  activeLog = gameLog;
  runReplay(gameLog, '原始日志重放');
}

$('startBtn').addEventListener('click', () => {
  feedback.unlock();
  startGame();
});
$('replayBtn').addEventListener('click', () => runReplay(gameLog, '原始日志重放'));
$('tamperBtn').addEventListener('click', tamperLog);
$('verifyBtn').addEventListener('click', verifyCurrent);

// Static initial boards.
renderBoard(liveCanvas, createEngine(0).state);
renderBoard(replayCanvas, createEngine(0).state);
