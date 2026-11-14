const fs = require('fs');
const path = require('path');
const { createCanvas, registerFont } = require('canvas');

registerFont(path.join(__dirname, '..', 'fonts', 'SourceHanSansSC.otf'),
  { family: 'NotoCJK' });

const C = require('../js/core.js');
global.window = global;
window.CliffDining = C;
window.performance = { now: () => Date.now() };

const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'renderer.js'), 'utf8');
(0, eval)(rendererSrc);
const R = window.RenderCliff;

const canvas = createCanvas(C.W, C.H);
const ctx = canvas.getContext('2d');
const g = C.createGame();

const shots = [
  { t: 2.0, file: 'shot-1-enroute.png' },
  { t: null, afterDelivery: 1, file: 'shot-2-deck1.png' },
  { t: null, afterDelivery: 3, file: 'shot-3-finish.png' },
];
let taken = new Set();

while (g.t < 60) {
  C.step(g, C.autopilot(g), 1 / 60);
  for (const s of shots) {
    if (taken.has(s.file)) continue;
    const ok = s.t !== null ? g.t >= s.t : g.deliveries.length >= s.afterDelivery;
    if (ok) {
      R.render(ctx, g);
      fs.writeFileSync(path.join(__dirname, '..', s.file), canvas.toBuffer('image/png'));
      taken.add(s.file);
      console.log('saved', s.file, 'at t =', g.t.toFixed(2), 'status =', g.status);
    }
  }
  if (taken.size === shots.length) break;
}

if (taken.size !== shots.length) {
  console.error('missing screenshots');
  process.exit(1);
}
console.log('screenshot: PASS');
