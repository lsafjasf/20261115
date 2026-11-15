// Pure acoustic model: hexagon geometry, propagation delay/gain, SPL coverage.
// No DOM or Web Audio here so the same code runs in Node tests.

export const SOUND_SPEED = 343;            // m/s, dry air ~20 C
export const HEX_RADIUS = 3;               // m, circumradius of the carpet
export const REF_DISTANCE = 1;             // m, gain = 1 at this distance
export const MAX_DELAY_MS = 100;
export const MIN_GAIN = 0.02;
export const REF_SPL = 90;                 // dB SPL produced by one speaker at 1 m

export const SPEAKER_IDS = ['FL', 'FR', 'RL', 'RR'];

// Four speaker groups sit on the midpoints of the four diagonal edges
// (distance = apothem from center), forming a regular FL/FR/BL/BR layout.
// Angle 0 = +x axis, measured counter-clockwise; y points toward the front.
export const SPEAKER_RADIUS = (HEX_RADIUS * Math.sqrt(3)) / 2;
// Listener faces +y, so +x is the listener's right.
const SPEAKER_ANGLES = { FR: Math.PI / 3, FL: (2 * Math.PI) / 3,
  RL: (4 * Math.PI) / 3, RR: (5 * Math.PI) / 3 };

export const SPEAKER_LABELS = {
  FR: '右前', FL: '左前', RL: '左后', RR: '右后'
};

// Web Audio 4-channel ordering: 0 FL, 1 FR, 2 RL, 3 RR.
export const QUAD_CHANNEL_INDEX = { FL: 0, FR: 1, RL: 2, RR: 3 };

// vertex index 0 starts at angle pi/2 (top), then clockwise.
export function hexVertex(index, radius = HEX_RADIUS) {
  const angle = Math.PI / 2 - (index % 6) * (Math.PI / 3);
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

export const HEX_VERTICES = Array.from({ length: 6 }, (_, i) => hexVertex(i));

export function speakerPosition(id) {
  const angle = SPEAKER_ANGLES[id];
  return { x: SPEAKER_RADIUS * Math.cos(angle),
    y: SPEAKER_RADIUS * Math.sin(angle) };
}

export const SPEAKERS = Object.fromEntries(
  SPEAKER_IDS.map((id) => [id, { id, ...speakerPosition(id) }])
);

export const MODES = {
  stereo: {
    id: 'stereo',
    label: '立体声 Stereo',
    outputChannels: 2,
    activeSpeakers: ['FL', 'FR'],
    processor: 'stereo-pan'
  },
  binaural: {
    id: 'binaural',
    label: '双耳 Binaural (HRTF)',
    outputChannels: 2,
    activeSpeakers: ['FL', 'FR', 'RL', 'RR'],
    processor: 'hrtf-panner'
  },
  quad: {
    id: 'quad',
    label: '四点环绕 Quad Surround',
    outputChannels: 4,
    activeSpeakers: ['FL', 'FR', 'RL', 'RR'],
    processor: 'channel-split'
  }
};

export const MODE_IDS = Object.keys(MODES);

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Propagation delay in milliseconds, clamped so the DelayNode range is bounded.
export function delayMs(listener, speaker = SPEAKERS) {
  const d = distance(listener, speaker);
  return Math.min(MAX_DELAY_MS, (d / SOUND_SPEED) * 1000);
}

// Point-source amplitude attenuation: 1/r with a near-field floor.
export function gainAt(listener, speaker = SPEAKERS) {
  const d = Math.max(distance(listener, speaker), REF_DISTANCE);
  return Math.max(MIN_GAIN, REF_DISTANCE / d);
}

// One speaker contribution in dB SPL; -6 dB per doubling of distance.
export function speakerSpl(listener, speaker = SPEAKERS) {
  const d = Math.max(distance(listener, speaker), REF_DISTANCE);
  return REF_SPL - 20 * Math.log10(d / REF_DISTANCE);
}

// Incoherent sum of independent sources: 10*log10(sum(10^(L/10))).
export function combinedSpl(listener, speakerIds = SPEAKER_IDS) {
  const energy = speakerIds.reduce((sum, id) => {
    return sum + Math.pow(10, speakerSpl(listener, SPEAKERS[id]) / 10);
  }, 0);
  return 10 * Math.log10(energy);
}

// Full per-speaker model used by both the audio engine and the UI panels.
export function computeField(listener, modeId) {
  const mode = MODES[modeId];
  if (!mode) throw new Error(`unknown mode: ${modeId}`);
  const speakers = SPEAKER_IDS.map((id) => {
    const d = distance(listener, SPEAKERS[id]);
    return {
      id,
      label: SPEAKER_LABELS[id],
      distance: d,
      delayMs: delayMs(listener, SPEAKERS[id]),
      gain: gainAt(listener, SPEAKERS[id]),
      spl: speakerSpl(listener, SPEAKERS[id]),
      active: mode.activeSpeakers.includes(id)
    };
  });
  const activeIds = speakers.filter((s) => s.active).map((s) => s.id);
  return {
    mode: modeId,
    outputChannels: mode.outputChannels,
    listener: { ...listener },
    speakers,
    combinedSpl: combinedSpl(listener, activeIds)
  };
}

// Grid of SPL samples inside the pointy-top hexagon, used for the heat-map.
export function coverageGrid(steps = 24, modeId = 'quad') {
  const active = MODES[modeId].activeSpeakers;
  const cells = [];
  let min = Infinity;
  let max = -Infinity;
  const halfWidth = (HEX_RADIUS * Math.sqrt(3)) / 2;
  for (let iy = 0; iy <= steps; iy += 1) {
    const y = -HEX_RADIUS + (2 * HEX_RADIUS * iy) / steps;
    for (let ix = 0; ix <= steps; ix += 1) {
      const x = -halfWidth + (2 * halfWidth * ix) / steps;
      if (!insideHex({ x, y })) continue;
      const spl = combinedSpl({ x, y }, active);
      min = Math.min(min, spl);
      max = Math.max(max, spl);
      cells.push({ x, y, spl });
    }
  }
  return { cells, min, max };
}

export function insideHex(point, radius = HEX_RADIUS) {
  // Pointy-top regular hexagon: top/bottom vertices on the y axis.
  const ax = Math.abs(point.x);
  const ay = Math.abs(point.y);
  const halfWidth = (radius * Math.sqrt(3)) / 2;
  return ay <= radius && ax <= halfWidth &&
    Math.sqrt(3) * ax + ay <= radius * Math.sqrt(3);
}
