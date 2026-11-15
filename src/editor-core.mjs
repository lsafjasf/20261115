// Shared, framework-free core logic for the three-shot cut editor.
// One continuous world animation is rendered through three virtual cameras
// (wide / medium / close-up). The user stitches the three sources into one
// 12-second take using three draggable cut points.

export const FPS = 30;
export const DURATION_S = 12;
export const TOTAL_FRAMES = FPS * DURATION_S; // 360
export const BOUNCE_PERIOD_S = 1.5;           // ball hits the floor every 1.5s
export const PEAK_TOLERANCE_FRAMES = 2;       // > 2 frames off a peak => warning

export const SHOTS = [
  { id: 'wide',   label: '远景 Wide',   zoom: 1.00, hue: 215, ringHue: 200 },
  { id: 'medium', label: '中景 Medium', zoom: 2.10, hue: 160, ringHue: 150 },
  { id: 'close',  label: '特写 Close',  zoom: 3.60, hue: 30,  ringHue: 350 },
];

// Output assembly: 4 segments, 3 cuts at 3s / 6s / 9s.
// The opening and closing segments reuse the wide shot.
export const SHOT_PLAN = [
  { shot: 0, startFrame: 0,   endFrame: 90 },
  { shot: 1, startFrame: 90,  endFrame: 180 },
  { shot: 2, startFrame: 180, endFrame: 270 },
  { shot: 0, startFrame: 270, endFrame: 360 },
];

// Default cut points, aligned to bounce peaks (frame multiples of 45).
export const DEFAULT_CUTS = [
  { frame: 90,  mode: 'hard' },
  { frame: 180, mode: 'crossfade' },
  { frame: 270, mode: 'hard' },
];

export const CROSSFADE_FRAMES = 8; // 8 frames, ~0.267s

export function frameToTime(frame) {
  return frame / FPS;
}

export function timeToFrame(time) {
  return Math.round(time * FPS);
}

export function clampFrame(frame) {
  return Math.max(1, Math.min(TOTAL_FRAMES - 1, Math.round(frame)));
}

// Action peaks are the floor-impact frames. Impact at t = k * 1.5s.
export function isPeakFrame(frame) {
  const period = BOUNCE_PERIOD_S * FPS;
  const phase = ((frame % period) + period) % period;
  return phase === 0;
}

export function nearestPeakFrame(frame) {
  const period = BOUNCE_PERIOD_S * FPS;
  const k = Math.round(frame / period);
  return clampFrame(k * period);
}

export function frameDistanceToPeak(frame) {
  return Math.abs(frame - nearestPeakFrame(frame));
}

// Ball state in world coordinates. The floor sits at worldY = 0.
export function ballState(timeS) {
  const period = BOUNCE_PERIOD_S;
  const phase = (((timeS % period) + period) % period) / period; // 0..1
  // Parabolic arc: height 0 at impact (phase 0), apex at phase 0.5.
  const height = 4 * 220 * phase * (1 - phase); // world units (px at zoom 1)
  const impactAge = phase * period;             // seconds since last impact
  const floorX = 480 + Math.sin(timeS * 0.55) * 60;
  // Squash for ~120ms after each impact, decaying quickly.
  const squash = Math.exp(-impactAge / 0.045) * (phase < 0.12 ? 1 : 0);
  return { floorX, height, squash, phase, impactAge };
}

// Output segment order (which source shot each segment shows).
export const SEGMENT_SHOTS = [0, 1, 2, 0];

export function validateCuts(cuts) {
  return cuts.map((cut, index) => {
    const nearest = nearestPeakFrame(cut.frame);
    const distance = Math.abs(cut.frame - nearest);
    return {
      index,
      frame: cut.frame,
      time: frameToTime(cut.frame),
      mode: cut.mode,
      nearestPeak: nearest,
      distance,
      status: distance <= PEAK_TOLERANCE_FRAMES ? 'ok' : 'warn',
      message: distance <= PEAK_TOLERANCE_FRAMES
        ? `对齐动作峰值（帧 ${nearest}）`
        : `偏离峰值 ${distance} 帧（容差 ${PEAK_TOLERANCE_FRAMES} 帧）`,
    };
  });
}

// Which source shot is on screen at a given output frame.
export function segmentIndexAt(frame, cuts) {
  let segment = 0;
  for (const cut of cuts) {
    if (frame >= cut.frame) segment += 1;
  }
  return Math.min(segment, SEGMENT_SHOTS.length - 1);
}

export function shotAtFrame(frame, cuts) {
  return SEGMENT_SHOTS[segmentIndexAt(frame, cuts)];
}

// Per-shot blend weights at an output time. Hard cuts switch instantly;
// crossfades keep both shots audible/visible with weights summing to 1.
// All math is frame-based to avoid float boundary errors at the center frame.
export function shotWeights(timeS, cuts) {
  const frame = timeToFrame(timeS);
  const weights = [0, 0, 0];
  const segment = segmentIndexAt(frame, cuts);
  weights[SEGMENT_SHOTS[segment]] = 1;

  cuts.forEach((cut, cutIndex) => {
    if (cut.mode !== 'crossfade') return;
    const half = CROSSFADE_FRAMES / 2;
    const delta = frame - cut.frame;
    if (delta >= -half && delta <= half) {
      const outgoing = SEGMENT_SHOTS[cutIndex];
      const incoming = SEGMENT_SHOTS[cutIndex + 1];
      const w = (delta + half) / (2 * half); // 0 -> 1 across the window
      weights[outgoing] = 1 - w;
      weights[incoming] = w;
    }
  });
  return weights;
}

export function sortedCutFrames(cuts) {
  return cuts.map((cut) => cut.frame).sort((a, b) => a - b);
}
