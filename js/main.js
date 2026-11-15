// 主装配：仿真循环、事件绑定
import { LAYER, ESCAPEMENT, gearById } from './data.js';
import {
  createSim, verifyTrain, verifyOk, computePhases,
  stepSim, startRecording, rpmOf,
} from './sim.js';
import { createView, fitView, render, toWorld } from './render.js';
import { createAudio } from './audio.js';
import {
  pickPart, describePart, renderVerifyLog, renderPartsBin,
  drawChart, exportCsv, exportPng,
} from './ui.js';

const $ = (id) => document.getElementById(id);

const sim = createSim();
const view = createView($('stage'));
const audio = createAudio();
let phases = computePhases();
let selectedId = null;
let lastSamples = null;

const layers = { [LAYER.GEAR]: true, [LAYER.ESC]: true, [LAYER.DIAL]: true };

fitView(view);
sim.onBeat = () => audio.tick();

function refreshVerify() {
  const results = verifyTrain();
  renderVerifyLog($('verifyLog'), results);
  const ok = results.every((r) => r.ok);
  $('btnStart').disabled = !ok || sim.running;
  return ok;
}

function refreshInspector() {
  if (!selectedId) return;
  const faulty = selectedId === 'third' && !verifyOk();
  $('partInfo').textContent = describePart(sim, selectedId, faulty);
}

function refreshPartsBin() {
  renderPartsBin($('partsBin'), selectedId, (part) => {
    const g = gearById(part.target);
    g.wheel = part.teeth;
    sim.time = 0;
    sim.beatCount = 0;
    sim.escapeAngle = 0;
    sim.escapeOmega = 0;
    sim.angles = {};
    sim.omegas = {};
    sim.recording = null;
    phases = computePhases();
    refreshVerify();
    refreshInspector();
    updateRecordUi();
  });
}

function updateRecordUi() {
  const rec = sim.recording;
  $('btnRecord').disabled = !sim.running || (rec && !rec.done);
  if (rec && rec.done) {
    lastSamples = rec.samples;
    $('recordStatus').textContent = `记录完成：${lastSamples.length} 个采样点（10 秒）。`;
    $('btnCsv').disabled = false;
    $('btnPng').disabled = false;
    drawChart($('chart'), lastSamples);
  } else if (rec) {
    const t = (sim.time - rec.t0).toFixed(1);
    $('recordStatus').textContent = `记录中… ${t} / 10 秒`;
  } else {
    $('recordStatus').textContent = sim.running ? '可开始记录。' : '需先启动仿真。';
    $('btnCsv').disabled = !lastSamples;
    $('btnPng').disabled = !lastSamples;
  }
}

$('stage').addEventListener('click', (e) => {
  const rect = $('stage').getBoundingClientRect();
  const sx = $('stage').width / rect.width;
  const sy = $('stage').height / rect.height;
  const w = toWorld(view, (e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy);
  selectedId = pickPart(w.x, w.y);
  refreshInspector();
  refreshPartsBin();
});

for (const [elId, layer] of [['layerGear', LAYER.GEAR], ['layerEsc', LAYER.ESC], ['layerDial', LAYER.DIAL]]) {
  $(elId).addEventListener('change', (e) => { layers[layer] = e.target.checked; });
}

$('btnVerify').addEventListener('click', refreshVerify);

$('btnStart').addEventListener('click', () => {
  sim.running = true;
  $('btnStart').disabled = true;
  $('btnPause').disabled = false;
  $('btnStep').disabled = true;
  $('btnRecord').disabled = false;
  updateRecordUi();
});

$('btnPause').addEventListener('click', () => {
  sim.running = false;
  $('btnStart').disabled = false;
  $('btnStart').textContent = '继续';
  $('btnPause').disabled = true;
  $('btnStep').disabled = false;
  updateRecordUi();
});

$('btnStep').addEventListener('click', () => {
  sim.running = true;
  stepSim(sim, ESCAPEMENT.beatPeriod / sim.timeScale);
  sim.running = false;
  refreshInspector();
});

$('speed').addEventListener('input', (e) => {
  sim.timeScale = +e.target.value;
  $('speedVal').textContent = `${sim.timeScale}x`;
});

$('audioOn').addEventListener('change', (e) => audio.setEnabled(e.target.checked));

$('btnRecord').addEventListener('click', () => {
  startRecording(sim);
  updateRecordUi();
});

$('btnCsv').addEventListener('click', () => lastSamples && exportCsv(lastSamples));
$('btnPng').addEventListener('click', () => lastSamples && exportPng($('chart')));

let lastTs = performance.now();
function frame(ts) {
  const dt = Math.min(0.1, (ts - lastTs) / 1000);
  lastTs = ts;
  stepSim(sim, dt);
  render(view, sim, phases, layers, selectedId);
  audio.update(Math.abs(rpmOf(sim, 'escape')), sim.ramp);
  if (sim.running && sim.time % 0.25 < dt * sim.timeScale) refreshInspector();
  if (sim.recording) updateRecordUi();
  requestAnimationFrame(frame);
}

refreshVerify();
refreshPartsBin();
requestAnimationFrame(frame);

// 测试钩子：世界坐标 -> 屏幕坐标
window.__toScreen = (wx, wy) => ({ x: wx * view.scale + view.ox, y: wy * view.scale + view.oy });
