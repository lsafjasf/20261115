#!/usr/bin/env node
/*
 * Reload layers.json, rebuild the same view from scratch, and prove:
 *  1. the reloaded view state matches the exported one exactly,
 *  2. a 4x render downscaled with an area average matches the 1x screen
 *     render (same geometry / labels / overlay positions),
 *  3. the 4x PNG carries real 4x raster detail, i.e. it is not a
 *     nearest-neighbor upscale of the low-resolution canvas.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const Engine = require('../src/map-engine.js');

const outDir = process.argv[2] || path.join(__dirname, '..', 'artifacts', 'exports');

function pixels(canvas) {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
}

function areaDownscale(src, width, height, factor) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const si = (((y * factor + dy) * width * factor) + (x * factor + dx)) * 4;
          r += src[si]; g += src[si + 1]; b += src[si + 2]; a += src[si + 3];
        }
      }
      const di = (y * width + x) * 4;
      const n = factor * factor;
      out[di] = r / n; out[di + 1] = g / n; out[di + 2] = b / n; out[di + 3] = a / n;
    }
  }
  return out;
}

function nearestUpscale(src, width, height, factor) {
  const out = new Uint8ClampedArray(width * factor * height * factor * 4);
  for (let y = 0; y < height * factor; y++) {
    for (let x = 0; x < width * factor; x++) {
      const si = ((Math.floor(y / factor) * width) + Math.floor(x / factor)) * 4;
      const di = (y * width * factor + x) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
    }
  }
  return out;
}

function meanAbsDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function edgeEnergy(data, width, height) {
  let sum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const dx = Math.abs(data[i] - data[i - 4]) +
        Math.abs(data[i + 1] - data[i - 3]) +
        Math.abs(data[i + 2] - data[i - 2]);
      const dy = Math.abs(data[i] - data[i - width * 4]) +
        Math.abs(data[i + 1] - data[i + 1 - width * 4]) +
        Math.abs(data[i + 2] - data[i + 2 - width * 4]);
      const gradient = (dx + dy) / 2;
      if (gradient > 10) { sum += gradient; count++; }
    }
  }
  return { meanEdgeGradient: sum / count, edgePixelRatio: count / (width * height) };
}

function mismatchRatio(a, b, threshold) {
  let bad = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2]));
    if (d > threshold) bad++;
  }
  return bad / (a.length / 4);
}

async function main() {
  const json = JSON.parse(fs.readFileSync(path.join(outDir, 'layers.json'), 'utf8'));
  const factor = json.exportScale;

  const reloaded = Engine.createView(json.viewport.width, json.viewport.height, json.view);
  const stateChecks = [
    ['zoom', reloaded.zoom, json.view.zoom],
    ['centerX', reloaded.centerX, json.view.centerX],
    ['centerY', reloaded.centerY, json.view.centerY],
    ['layers.terrain', reloaded.layers.terrain, json.view.layers.terrain],
    ['layers.roads', reloaded.layers.roads, json.view.layers.roads],
    ['layers.water', reloaded.layers.water, json.view.layers.water],
  ];
  stateChecks.forEach(function ([name, actual, expected]) {
    if (actual !== expected) throw new Error('reload mismatch on ' + name);
  });

  const png4xImage = await loadImage(path.join(outDir, json.files.png4x));
  const expectedW = json.viewport.width * factor;
  const expectedH = json.viewport.height * factor;
  if (png4xImage.width !== expectedW || png4xImage.height !== expectedH) {
    throw new Error('PNG size mismatch');
  }

  const canvas4x = createCanvas(expectedW, expectedH);
  canvas4x.getContext('2d').drawImage(png4xImage, 0, 0);
  const hi = pixels(canvas4x);

  const canvasReload1x = createCanvas(json.viewport.width, json.viewport.height);
  Engine.render(canvasReload1x.getContext('2d'), reloaded, 1);
  const reloaded1x = pixels(canvasReload1x);

  const screenImage = await loadImage(path.join(outDir, json.files.screenPreview));
  const canvasScreen = createCanvas(screenImage.width, screenImage.height);
  canvasScreen.getContext('2d').drawImage(screenImage, 0, 0);
  const screen1x = pixels(canvasScreen);

  const downscaled = areaDownscale(hi, json.viewport.width, json.viewport.height, factor);
  const parityMad = meanAbsDiff(downscaled, reloaded1x);
  const parityBad = mismatchRatio(downscaled, reloaded1x, 12);

  const fake4x = nearestUpscale(screen1x, json.viewport.width, json.viewport.height, factor);
  const upscaleMad = meanAbsDiff(fake4x, hi);
  const realEdges = edgeEnergy(hi, expectedW, expectedH);
  const fakeEdges = edgeEnergy(fake4x, expectedW, expectedH);

  const result = {
    reloadedView: json.view,
    png4xSize: { width: expectedW, height: expectedH },
    downscaleVsReload_meanAbsDiff: Number(parityMad.toFixed(3)),
    downscaleVsReload_badPixelRatio: Number(parityBad.toFixed(5)),
    fakeNearestUpscaleVsReal4x_meanAbsDiff: Number(upscaleMad.toFixed(3)),
    real4x_meanEdgeGradient: Number(realEdges.meanEdgeGradient.toFixed(2)),
    fake4x_meanEdgeGradient: Number(fakeEdges.meanEdgeGradient.toFixed(2)),
  };

  const pass = parityMad < 1.0 &&
    parityBad < 0.02 &&
    realEdges.meanEdgeGradient > fakeEdges.meanEdgeGradient * 1.15;
  console.log(JSON.stringify(result, null, 2));
  if (!pass) {
    throw new Error('verification thresholds failed (see metrics above)');
  }
  console.log('VERIFY PASSED: JSON reload reproduces the view; 4x PNG is genuinely high resolution.');
}

main().catch(function (err) {
  console.error('VERIFY FAILED:', err.message);
  process.exit(1);
});
