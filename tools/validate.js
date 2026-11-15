import {
  DIRECTIONS,
  PRE_ROLL,
  TRANSITION_TYPES,
  createTransitionRenderer,
  sampleTimeline,
} from "../src/transitions.js";

const width = 640;
const height = 360;
const phases = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
const duration = 2;
const canvas = document.createElement("canvas");
canvas.width = width;
canvas.height = height;
const ctx = canvas.getContext("2d", { alpha: false });
const renderer = createTransitionRenderer(width, height);
const failures = [];
const samples = [];
let worstBlackPixels = 0;

function percentage(value, total) {
  return Number(((value / total) * 100).toFixed(3));
}

try {
  for (const type of TRANSITION_TYPES) {
    for (const direction of DIRECTIONS) {
      for (const phase of phases) {
        renderer.renderPhase(ctx, { phase, duration, type, direction });
        const pixels = ctx.getImageData(0, 0, width, height).data;
        let transparent = 0;
        let nearBlack = 0;
        let exactBlack = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] < 255) transparent += 1;
          const sum = pixels[index] + pixels[index + 1] + pixels[index + 2];
          if (sum < 18) nearBlack += 1;
          if (sum === 0) exactBlack += 1;
        }
        worstBlackPixels = Math.max(worstBlackPixels, nearBlack);
        if (transparent > 0) failures.push(`${type}/${direction}/${phase}: transparent pixels`);
        if (nearBlack > 0) failures.push(`${type}/${direction}/${phase}: near-black pixels`);
        if (exactBlack > 0) failures.push(`${type}/${direction}/${phase}: black pixels`);
        samples.push({
          type,
          direction,
          phase,
          transparent,
          nearBlack,
          exactBlack,
        });
      }
    }
  }

  const midpoint = sampleTimeline(PRE_ROLL + duration / 2, duration);
  if (midpoint.phase !== 0.5) failures.push("midpoint phase is not 0.5");
  if (midpoint.aTime !== 4.2 || midpoint.bTime !== 1) {
    failures.push("midpoint local clocks are wrong");
  }
  const after = sampleTimeline(PRE_ROLL + duration + 0.8, duration);
  if (after.bTime !== 2.8 || after.aTime === after.bTime) {
    failures.push("B did not continue on its own clock after the transition");
  }
} catch (error) {
  failures.push(error.stack || String(error));
}

const result = {
  pass: failures.length === 0,
  checkedFrames: samples.length,
  worstBlackPixels,
  blackPixelRatio: percentage(worstBlackPixels, width * height),
  failures,
  midpoint: {
    phase: 0.5,
    aTime: 4.2,
    bTime: 1,
  },
};

document.body.dataset.pass = String(result.pass);
document.querySelector("#result").textContent = JSON.stringify(result, null, 2);
