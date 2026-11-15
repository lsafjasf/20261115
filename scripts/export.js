#!/usr/bin/env node
/*
 * Headless export driven by the same vector engine as the browser UI.
 * Usage:
 *   node scripts/export.js [session.json] [outDir]
 * Produces:
 *   map-4x.png        4x re-rasterized viewport PNG (not a canvas upscale)
 *   screen-1x.png     1x screen-resolution render for parity verification
 *   layers.json       layer definitions + exact view state for reload
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const Data = require('../src/map-data.js');
const Engine = require('../src/map-engine.js');

async function main() {
  const sessionPath = process.argv[2] || path.join(__dirname, '..', 'artifacts', 'session.json');
  const outDir = process.argv[3] || path.join(__dirname, '..', 'artifacts', 'exports');
  fs.mkdirSync(outDir, { recursive: true });

  const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  const view = Engine.createView(session.width, session.height, session.view);
  const scale = session.exportScale || 4;

  const canvas4x = createCanvas(view.width * scale, view.height * scale);
  Engine.render(canvas4x.getContext('2d'), view, scale);
  fs.writeFileSync(path.join(outDir, 'map-4x.png'), canvas4x.toBuffer('image/png'));

  const canvas1x = createCanvas(view.width, view.height);
  Engine.render(canvas1x.getContext('2d'), view, 1);
  fs.writeFileSync(path.join(outDir, 'screen-1x.png'), canvas1x.toBuffer('image/png'));

  const json = {
    format: 'map-export/1',
    exportedAt: new Date().toISOString(),
    world: Data.WORLD,
    units: 'meters',
    viewport: { width: view.width, height: view.height },
    exportScale: scale,
    view: {
      zoom: view.zoom,
      centerX: view.centerX,
      centerY: view.centerY,
      layers: view.layers,
    },
    layers: {
      terrain: {
        visible: view.layers.terrain,
        styles: Data.terrainStyles,
        features: Data.terrain,
      },
      water: {
        visible: view.layers.water,
        features: Data.water,
      },
      roads: {
        visible: view.layers.roads,
        features: Data.roads,
      },
      towns: { features: Data.towns },
    },
    legend: Engine.legendEntries(view),
    files: {
      png4x: 'map-4x.png',
      screenPreview: 'screen-1x.png',
    },
  };
  fs.writeFileSync(path.join(outDir, 'layers.json'), JSON.stringify(json, null, 2));

  console.log(JSON.stringify({
    outDir,
    png4x: { file: 'map-4x.png', width: view.width * scale, height: view.height * scale },
    screen1x: { file: 'screen-1x.png', width: view.width, height: view.height },
    json: 'layers.json',
    view: json.view,
  }, null, 2));
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
