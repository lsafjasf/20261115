export const WORLD = { width: 1280, height: 800 };

export const CONFIG = {
  roadHalfWidth: 4.5,
  lateralMin: -8.2,
  lateralMax: 8.2,
  lateralBins: 33,
  targetDose: 0.016,
  coveragePass: 0.85,
  minRemaining: 0.12,
  initialMassKg: 150,
  flowKgPerSec: 3,
  pixelsPerMeter: 7.5,
  sampleSpacingPx: 4,
  streamBuffer: 5.7,
  speed: { min: 8, max: 30, default: 22 },
  width: { min: 3.2, max: 10.2, default: 6.5 },
  outlet: { min: 0.2, max: 1, default: 0.62 },
};

const SECTION_DEFS = [
  {
    name: "松林缓坡",
    code: "S-01",
    note: "缓弯 · 侧风弱",
    streamRisk: 0.35,
    points: [
      [160, 105], [250, 132], [355, 184], [470, 232], [600, 262], [725, 272],
    ],
  },
  {
    name: "鹰嘴回头弯",
    code: "S-02",
    note: "急弯 · 强离心",
    streamRisk: 1,
    points: [
      [725, 272], [842, 286], [963, 330], [1051, 405], [1102, 500],
      [1098, 596], [1052, 672], [966, 723], [850, 748], [735, 750],
    ],
  },
  {
    name: "溪桥下坡",
    code: "S-03",
    note: "连续 S 弯 · 临溪",
    streamRisk: 0.8,
    points: [
      [735, 750], [614, 752], [505, 737], [405, 704],
      [320, 655], [263, 588], [247, 515], [275, 445], [335, 398],
    ],
  },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function catmullRom(points, detail = 22) {
  const padded = [points[0], ...points, points.at(-1)];
  const output = [];
  for (let i = 1; i < padded.length - 2; i += 1) {
    const [x0, y0] = padded[i - 1];
    const [x1, y1] = padded[i];
    const [x2, y2] = padded[i + 1];
    const [x3, y3] = padded[i + 2];
    for (let step = 0; step < detail; step += 1) {
      const t = step / detail;
      const t2 = t * t;
      const t3 = t2 * t;
      output.push({
        x: 0.5 * ((2 * x1) + (-x0 + x2) * t
          + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2
          + (-x0 + 3 * x1 - 3 * x2 + x3) * t3),
        y: 0.5 * ((2 * y1) + (-y0 + y2) * t
          + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2
          + (-y0 + 3 * y1 - 3 * y2 + y3) * t3),
      });
    }
  }
  output.push({ x: points.at(-1)[0], y: points.at(-1)[1] });
  return output;
}

function resample(points, spacing) {
  const output = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const segment = Math.hypot(b.x - a.x, b.y - a.y);
    let travelled = spacing - carry;
    while (travelled <= segment) {
      const ratio = travelled / segment;
      output.push({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio });
      travelled += spacing;
    }
    carry = segment - (travelled - spacing);
  }
  const last = points.at(-1);
  if (Math.hypot(output.at(-1).x - last.x, output.at(-1).y - last.y) > 1.5) {
    output.push(last);
  }
  return output;
}

function decorateSamples(rawSamples) {
  const samples = rawSamples.map((point, index) => {
    const before = rawSamples[Math.max(0, index - 1)];
    const after = rawSamples[Math.min(rawSamples.length - 1, index + 1)];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      ...point,
      tx: dx / length,
      ty: dy / length,
      nx: -dy / length,
      ny: dx / length,
      curve: 0,
    };
  });

  for (let index = 0; index < samples.length; index += 1) {
    const before = samples[Math.max(0, index - 5)];
    const after = samples[Math.min(samples.length - 1, index + 5)];
    const first = Math.atan2(samples[index].ty, samples[index].tx);
    const second = Math.atan2(after.ty, after.tx);
    let turn = second - first;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    samples[index].curve = clamp(turn * 7, -1, 1);
  }

  return samples.map((sample, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = -6; offset <= 6; offset += 1) {
      const target = samples[clamp(index + offset, 0, samples.length - 1)];
      sum += target.curve;
      count += 1;
    }
    return { ...sample, curve: sum / count };
  });
}

function buildTrack() {
  let sampleCursor = 0;
  let lengthPx = 0;
  const sections = SECTION_DEFS.map((definition, index) => {
    const samples = decorateSamples(
      resample(catmullRom(definition.points), CONFIG.sampleSpacingPx),
    );
    const sectionLength = (samples.length - 1) * CONFIG.sampleSpacingPx;
    const section = {
      ...definition,
      index,
      samples,
      startSample: sampleCursor,
      endSample: sampleCursor + samples.length - 1,
      startPx: lengthPx,
      endPx: lengthPx + sectionLength,
      lengthM: sectionLength / CONFIG.pixelsPerMeter,
    };
    sampleCursor += samples.length;
    lengthPx += sectionLength;
    return section;
  });

  return {
    sections,
    samples: sections.flatMap((section) => section.samples),
    lengthPx,
    lengthM: lengthPx / CONFIG.pixelsPerMeter,
  };
}

export const TRACK = buildTrack();

function gaussianDistribution(width, drift, speed) {
  const speedRatio = clamp(speed / CONFIG.speed.max, 0, 1);
  const sigma = Math.max(1.05, width / 2.28 + Math.abs(drift) * speedRatio * 0.06);
  const binWidth = (CONFIG.lateralMax - CONFIG.lateralMin) / (CONFIG.lateralBins - 1);
  const weights = new Array(CONFIG.lateralBins);
  let sum = 0;
  for (let bin = 0; bin < CONFIG.lateralBins; bin += 1) {
    const lateral = CONFIG.lateralMin + bin * binWidth;
    const weight = Math.exp(-0.5 * ((lateral - drift) / sigma) ** 2);
    weights[bin] = weight;
    sum += weight;
  }
  return weights.map((weight) => weight / (sum || 1));
}

export class SaltRun {
  constructor() {
    this.controls = {
      width: CONFIG.width.default,
      speed: CONFIG.speed.default,
      outlet: CONFIG.outlet.default,
    };
    this.reset();
  }

  reset() {
    this.status = "ready";
    this.progressPx = 0;
    this.progressM = 0;
    this.materialUsed = 0;
    this.pollutionLoad = 0;
    this.oversprayMass = 0;
    this.lastSampleIndex = -1;
    this.activeSection = 0;
    this.lastDrift = 0;
    this.elapsed = 0;
    this.density = new Float32Array(
      TRACK.samples.length * CONFIG.lateralBins,
    );
  }

  start() {
    if (this.status === "ready") this.status = "running";
    return this;
  }

  setControls(next) {
    this.controls.width = clamp(
      Number(next.width ?? this.controls.width),
      CONFIG.width.min,
      CONFIG.width.max,
    );
    this.controls.speed = clamp(
      Number(next.speed ?? this.controls.speed),
      CONFIG.speed.min,
      CONFIG.speed.max,
    );
    this.controls.outlet = clamp(
      Number(next.outlet ?? this.controls.outlet),
      CONFIG.outlet.min,
      CONFIG.outlet.max,
    );
  }

  step(dt, controls = this.controls) {
    if (this.status !== "running") return;
    this.setControls(controls);
    dt = clamp(Number(dt) || 0, 0, 0.2);
    if (dt === 0) return;

    const remainingKg = Math.max(0, CONFIG.initialMassKg - this.materialUsed);
    const requestedKg = CONFIG.flowKgPerSec * this.controls.outlet * dt;
    const usedKg = Math.min(remainingKg, requestedKg);
    const effectiveOutlet = requestedKg > 0 ? usedKg / requestedKg : 0;
    const speedMps = this.controls.speed / 3.6;
    const massPerMeter = (CONFIG.flowKgPerSec * this.controls.outlet * effectiveOutlet)
      / speedMps;
    const oldPx = this.progressPx;
    const nextPx = Math.min(TRACK.lengthPx, oldPx + speedMps * CONFIG.pixelsPerMeter * dt);
    const startIndex = Math.max(0, this.lastSampleIndex + 1);
    const endIndex = Math.min(
      TRACK.samples.length - 1,
      Math.floor(nextPx / CONFIG.sampleSpacingPx),
    );

    if (usedKg > 0) {
      for (let index = startIndex; index <= endIndex; index += 1) {
        this.deposit(index, massPerMeter);
      }
    }

    this.lastSampleIndex = Math.max(this.lastSampleIndex, endIndex);
    this.materialUsed += usedKg;
    this.progressPx = nextPx;
    this.progressM = nextPx / CONFIG.pixelsPerMeter;
    this.elapsed += dt;
    this.activeSection = this.getSectionAtPx(this.progressPx).index;
    if (this.progressPx >= TRACK.lengthPx - 0.1) {
      this.progressPx = TRACK.lengthPx;
      this.progressM = TRACK.lengthM;
      this.status = "finished";
    }
  }

  deposit(sampleIndex, massPerMeter) {
    const sample = TRACK.samples[sampleIndex];
    const section = this.getSectionAtPx(sampleIndex * CONFIG.sampleSpacingPx);
    const speedRatio = clamp(this.controls.speed / CONFIG.speed.max, 0, 1);
    const drift = clamp(-sample.curve * speedRatio * 3.55, -3.55, 3.55);
    const weights = gaussianDistribution(this.controls.width, drift, this.controls.speed);
    const binWidth = (CONFIG.lateralMax - CONFIG.lateralMin) / (CONFIG.lateralBins - 1);
    const row = sampleIndex * CONFIG.lateralBins;
    let outside = 0;
    for (let bin = 0; bin < CONFIG.lateralBins; bin += 1) {
      const lateral = CONFIG.lateralMin + bin * binWidth;
      const dose = (massPerMeter * weights[bin]) / binWidth;
      this.density[row + bin] += dose;
      if (Math.abs(lateral) > CONFIG.streamBuffer) {
        outside += dose * binWidth;
      }
    }
    this.lastDrift = drift;
    this.oversprayMass += outside;
    this.pollutionLoad += outside * section.streamRisk;
  }

  getSectionAtPx(distancePx) {
    for (let index = 0; index < TRACK.sections.length; index += 1) {
      const section = TRACK.sections[index];
      if (distancePx <= section.endPx + 0.01) return section;
    }
    return TRACK.sections.at(-1);
  }

  getSectionStats() {
    const binWidth = (CONFIG.lateralMax - CONFIG.lateralMin) / (CONFIG.lateralBins - 1);
    return TRACK.sections.map((section) => {
      let cells = 0;
      let covered = 0;
      let doseSum = 0;
      let curveChecks = 0;
      let curveMissing = 0;
      let outerChecks = 0;
      let outerMissing = 0;
      for (let sampleIndex = section.startSample; sampleIndex <= section.endSample; sampleIndex += 1) {
        const sample = TRACK.samples[sampleIndex];
        const row = sampleIndex * CONFIG.lateralBins;
        for (let bin = 0; bin < CONFIG.lateralBins; bin += 1) {
          const lateral = CONFIG.lateralMin + bin * binWidth;
          if (Math.abs(lateral) > CONFIG.roadHalfWidth) continue;
          const dose = this.density[row + bin];
          cells += 1;
          doseSum += dose;
          if (dose >= CONFIG.targetDose) covered += 1;
          if (Math.abs(lateral) > CONFIG.roadHalfWidth * 0.58) {
            outerChecks += 1;
            if (dose < CONFIG.targetDose) outerMissing += 1;
            if (Math.abs(sample.curve) > 0.16) {
              curveChecks += 1;
              if (dose < CONFIG.targetDose) curveMissing += 1;
            }
          }
        }
      }
      const coverage = cells ? covered / cells : 0;
      return {
        index: section.index,
        name: section.name,
        code: section.code,
        note: section.note,
        coverage,
        averageDose: cells ? doseSum / cells : 0,
        curveLeak: curveChecks ? curveMissing / curveChecks : 0,
        outerLeak: outerChecks ? outerMissing / outerChecks : 0,
        pass: coverage >= CONFIG.coveragePass,
      };
    });
  }

  getStats() {
    const sections = this.getSectionStats();
    const remaining = Math.max(0, 1 - this.materialUsed / CONFIG.initialMassKg);
    const pollution = clamp((this.pollutionLoad / 18) * 100, 0, 100);
    const allPass = sections.every((section) => section.pass);
    const enoughMaterial = remaining >= CONFIG.minRemaining;
    return {
      sections,
      coverage: sections.reduce((sum, section) => sum + section.coverage, 0) / sections.length,
      remaining,
      pollution,
      oversprayMass: this.oversprayMass,
      materialUsed: this.materialUsed,
      allPass,
      enoughMaterial,
      success: this.status === "finished" && allPass && enoughMaterial,
      complete: this.status === "finished",
      progress: clamp(this.progressPx / TRACK.lengthPx, 0, 1),
      activeSection: this.activeSection,
      elapsed: this.elapsed,
    };
  }

  getSampleAtProgress(progress = this.progressPx / TRACK.lengthPx) {
    const index = clamp(
      Math.round(progress * (TRACK.samples.length - 1)),
      0,
      TRACK.samples.length - 1,
    );
    return { ...TRACK.samples[index], index };
  }
}

export function createRun() {
  return new SaltRun();
}
