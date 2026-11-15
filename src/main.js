import { createApp } from './app.js';

const ui = {
  threshold: document.getElementById('threshold'),
  thresholdValue: document.getElementById('threshold-value'),
  metrics: document.getElementById('metrics'),
  sweepLog: document.getElementById('sweep-log'),
  exportSVG: document.getElementById('export-svg'),
  exportPNG: document.getElementById('export-png'),
  autoRotate: document.getElementById('auto-rotate'),
  sweep: document.getElementById('sweep'),
  reset: document.getElementById('reset'),
};

const glCanvas = document.getElementById('gl-canvas');
const overlayCanvas = document.getElementById('overlay-canvas');

createApp({ glCanvas, overlayCanvas, ui });
