import { CanvasMeasurer } from '../src/measurer.js';
import { layoutDocument, LANGUAGE_PRESETS } from '../src/layout.js';
import { detectAll } from '../src/detect.js';
import { autoRepair } from '../src/repair.js';
import { exportSVG } from '../src/svg.js';
import { document as sampleDocument, initialParams } from '../demo/document.js';

const measurer = new CanvasMeasurer();
const state = {
  document: structuredClone(sampleDocument),
  params: structuredClone(initialParams),
  layout: null,
  issues: [],
  logs: []
};

const els = {
  mode: document.querySelector('#modeSelect'),
  size: document.querySelector('#sizeInput'),
  sizeLabel: document.querySelector('#sizeLabel'),
  lineHeight: document.querySelector('#lineHeightInput'),
  lineHeightLabel: document.querySelector('#lineHeightLabel'),
  breakMode: document.querySelector('#breakSelect'),
  detect: document.querySelector('#detectBtn'),
  repair: document.querySelector('#repairBtn'),
  exportBtn: document.querySelector('#exportBtn'),
  lockList: document.querySelector('#lockList'),
  issues: document.querySelector('#issueList'),
  logs: document.querySelector('#logList'),
  canvas: document.querySelector('#preview')
};

for (const [name, preset] of Object.entries(LANGUAGE_PRESETS)) {
  const option = document.createElement('option');
  option.value = name;
  option.textContent = preset.label;
  els.mode.appendChild(option);
}

function syncControls() {
  els.size.value = state.params.font.sizePx;
  els.sizeLabel.textContent = `${state.params.font.sizePx}px`;
  els.lineHeight.value = state.params.font.lineHeight;
  els.lineHeightLabel.textContent = state.params.font.lineHeight.toFixed(2);
  els.breakMode.value = state.params.breakMode;
}

function renderLocks() {
  els.lockList.replaceChildren();
  for (const para of state.document.paragraphs) {
    const row = document.createElement('label');
    row.className = 'lock-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(para.locked);
    checkbox.addEventListener('change', () => {
      para.locked = checkbox.checked;
      if (!para.locked) delete para.frame;
      reflow();
    });
    row.append(checkbox, document.createTextNode(`${para.id}：${para.text.slice(0, 24)}…`));
    els.lockList.appendChild(row);
  }
}

function renderIssues() {
  els.issues.replaceChildren();
  if (state.issues.length === 0) {
    const item = document.createElement('li');
    item.textContent = '未检测到孤字、重叠或超框';
    els.issues.appendChild(item);
    return;
  }
  for (const issue of state.issues) {
    const item = document.createElement('li');
    item.dataset.severity = issue.severity;
    item.textContent = issue.detail;
    els.issues.appendChild(item);
  }
}

function renderLogs() {
  els.logs.replaceChildren();
  if (state.logs.length === 0) {
    const item = document.createElement('li');
    item.textContent = '暂无修复动作';
    els.logs.appendChild(item);
    return;
  }
  for (const log of state.logs) {
    const item = document.createElement('li');
    item.textContent = log;
    els.logs.appendChild(item);
  }
}

function drawCanvas() {
  const ctx = els.canvas.getContext('2d');
  const { width, height } = state.layout.size;
  els.canvas.width = width + 40;
  els.canvas.height = Math.max(760, height + 40);
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(20, 20, width, height);
  ctx.strokeStyle = '#9ca3af';
  ctx.strokeRect(20.5, 20.5, width, height);

  const font = state.params.font;
  ctx.font = `${font.sizePx}px ${font.family}`;
  ctx.textBaseline = 'alphabetic';
  for (const para of state.layout.paragraphs) {
    if (para.locked) {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#d97706';
      ctx.strokeRect(20 + para.frame.x, 20 + para.frame.y, para.frame.w, para.frame.h);
      ctx.restore();
    }
    ctx.fillStyle = '#1f2937';
    for (const line of para.lines) {
      for (const item of line.items) {
        ctx.fillText(
          item.token.text,
          20 + para.frame.x + state.params.padding + item.x,
          20 + para.frame.y + state.params.padding + item.y
        );
      }
    }
  }
}

function reflow() {
  state.layout = layoutDocument(state.document, state.params, measurer);
  state.issues = detectAll(state.layout, state.params);
  renderIssues();
  drawCanvas();
}

function applyModePreset(name) {
  const preset = LANGUAGE_PRESETS[name];
  state.params.breakMode = preset.breakMode;
  state.params.justify = preset.justify;
  Object.assign(state.params.font, preset.font);
  syncControls();
  reflow();
}

els.mode.addEventListener('change', () => applyModePreset(els.mode.value));
els.size.addEventListener('input', () => {
  state.params.font.sizePx = Number(els.size.value);
  syncControls();
  reflow();
});
els.lineHeight.addEventListener('input', () => {
  state.params.font.lineHeight = Number(els.lineHeight.value);
  syncControls();
  reflow();
});
els.breakMode.addEventListener('change', () => {
  state.params.breakMode = els.breakMode.value;
  reflow();
});
els.detect.addEventListener('click', reflow);
els.repair.addEventListener('click', () => {
  const result = autoRepair(state.document, state.params, measurer);
  state.document = result.document;
  state.params = result.params;
  state.layout = result.layout;
  state.issues = result.issuesAfter;
  state.logs = result.logs;
  syncControls();
  renderLocks();
  renderIssues();
  renderLogs();
  drawCanvas();
});
els.exportBtn.addEventListener('click', () => {
  const svg = exportSVG(state.layout);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'typeset.svg';
  link.click();
  URL.revokeObjectURL(url);
});

syncControls();
renderLocks();
renderLogs();
reflow();
