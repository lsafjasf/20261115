#!/usr/bin/env node
/*
 * Reload an exported layers.json and render the recovered view to disk.
 * This is the round-trip counterpart of export.js: no session file is used,
 * the view is reconstructed solely from the exported JSON.
 * Usage: node scripts/reload-view.js [exportDir]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const Engine = require('../src/map-engine.js');

const dir = process.argv[2] || path.join(__dirname, '..', 'artifacts', 'exports');
const json = JSON.parse(fs.readFileSync(path.join(dir, 'layers.json'), 'utf8'));

const view = Engine.createView(json.viewport.width, json.viewport.height, json.view);
const canvas = createCanvas(view.width, view.height);
Engine.render(canvas.getContext('2d'), view, 1);
const out = path.join(dir, 'reloaded-1x.png');
fs.writeFileSync(out, canvas.toBuffer('image/png'));

console.log(JSON.stringify({
  output: out,
  size: { width: view.width, height: view.height },
  recoveredView: {
    zoom: view.zoom,
    centerX: view.centerX,
    centerY: view.centerY,
    layers: view.layers,
  },
}, null, 2));
