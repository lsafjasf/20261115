import { TOTAL_FRAMES, frameToTime, shotWeights } from './editor-core.mjs';

// Shot timbres: each source has its own continuous ambient bed. The beds
// never stop; only their gains follow the edit weights, so no cut can open
// a silent hole. Impact "thumps" live on a shared bus (one action, one hit).
const SHOT_AUDIO = [
  { noiseGain: 0.055, filterFreq: 520,  oscFreq: 110, oscGain: 0.030, thumpFreq: 92,  thumpGain: 0.30 },
  { noiseGain: 0.070, filterFreq: 1050, oscFreq: 164, oscGain: 0.034, thumpFreq: 116, thumpGain: 0.36 },
  { noiseGain: 0.085, filterFreq: 1900, oscFreq: 220, oscGain: 0.040, thumpFreq: 146, thumpGain: 0.44 },
];

function makeNoiseBuffer(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    // Pink-ish low-passed noise reads as "room tone / ambience".
    last = last * 0.965 + white * 0.035;
    data[i] = last * 4.2 + white * 0.08;
  }
  return buffer;
}

// Build the shared source graph once, returning per-shot ambient gains and
// the shared thump bus. Works with both BaseAudioContext implementations.
// All events are scheduled relative to `origin` so live preview and export
// can start on a precise future sample.
export function buildAudioGraph(ctx, durationS, origin = 0) {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  const ambientGains = SHOT_AUDIO.map((cfg, shotIndex) => {
  const source = ctx.createBufferSource();
  source.buffer = makeNoiseBuffer(ctx, durationS + 1);
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = cfg.filterFreq;
  filter.Q.value = 0.7;
  const pad = ctx.createOscillator();
  pad.type = shotIndex === 2 ? 'triangle' : 'sine';
  pad.frequency.value = cfg.oscFreq;
  const padGain = ctx.createGain();
  padGain.gain.value = cfg.oscGain;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain);
  pad.connect(padGain).connect(gain);
  gain.connect(master);
  source.start(origin);
  pad.start(origin);
  return gain;
  });

  // Thump voice per shot: scheduled per action peak, routed through that
  // shot's ambient gain so it follows the same edit (hard cut / crossfade).
  const thumpVoices = SHOT_AUDIO.map(() => []);
  const periodFrames = 45; // one peak every 1.5s
  for (let frame = 0; frame <= TOTAL_FRAMES; frame += periodFrames) {
    const t = origin + frameToTime(frame);
    SHOT_AUDIO.forEach((cfg, shotIndex) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(cfg.thumpFreq * 1.35, t);
      osc.frequency.exponentialRampToValueAtTime(cfg.thumpFreq * 0.55, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(cfg.thumpGain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(g).connect(ambientGains[shotIndex]);
      osc.start(t);
      osc.stop(t + 0.26);
      thumpVoices[shotIndex].push({ time: t, gain: g });
    });
  }
  return { master, ambientGains, thumpVoices, origin };
}

// Drive the three shot gains from the edit timeline. Sampling every frame is
// fine for AudioParam automation: hard cuts become instant value jumps,
// crossfades become short ramps, and the three gains always sum to ~1.
export function scheduleEditGains(ctx, ambientGains, cuts, startTime = 0) {
  for (let frame = 0; frame <= TOTAL_FRAMES; frame += 1) {
    const t = startTime + frameToTime(frame);
    const weights = shotWeights(frameToTime(frame), cuts);
    ambientGains.forEach((gainNode, shotIndex) => {
      gainNode.gain.setValueAtTime(Math.max(0.0001, weights[shotIndex]), t);
    });
  }
}

// Offline render of the full mix, then scan for silent gaps. A "gap" is any
// 20ms window whose RMS is under -60 dBFS. Returns diagnostics for the report.
export async function renderOffline(cuts, durationS = 12) {
  const sampleRate = 48000;
  const ctx = new OfflineAudioContext(2, sampleRate * durationS, sampleRate);
  const { ambientGains } = buildAudioGraph(ctx, durationS, 0);
  scheduleEditGains(ctx, ambientGains, cuts);
  const rendered = await ctx.startRendering();
  return analyzeContinuity(rendered, cuts);
}

export function analyzeContinuity(buffer, cuts) {
  const data = buffer.getChannelData(0);
  const window = Math.floor(buffer.sampleRate * 0.02); // 20ms
  const windows = [];
  let minRms = Infinity;
  let minRmsAt = 0;
  for (let start = 0; start + window <= data.length; start += window) {
    let sumSq = 0;
    for (let i = start; i < start + window; i += 1) sumSq += data[i] * data[i];
    const rms = Math.sqrt(sumSq / window);
    const db = 20 * Math.log10(rms + 1e-12);
    windows.push(db);
    if (rms < minRms) {
      minRms = rms;
      minRmsAt = start / buffer.sampleRate;
    }
  }
  const silentWindows = windows
    .map((db, index) => ({ db, time: index * 0.02 }))
    .filter((entry) => entry.db <= -60);

  // Level envelope around each cut: 100ms before and after.
  const aroundCuts = cuts.map((cut) => {
    const center = frameToTime(cut.frame);
    const probe = (offset) => {
      const idx = Math.floor((center + offset) * buffer.sampleRate);
      const from = Math.max(0, idx - window / 2);
      let sumSq = 0;
      for (let i = from; i < from + window && i < data.length; i += 1) {
        sumSq += data[i] * data[i];
      }
      return 20 * Math.log10(Math.sqrt(sumSq / window) + 1e-12);
    };
    return {
      frame: cut.frame,
      mode: cut.mode,
      beforeDb: probe(-0.1),
      atDb: probe(0),
      afterDb: probe(0.1),
    };
  });

  return {
    durationS: buffer.duration,
    minRmsDb: 20 * Math.log10(minRms + 1e-12),
    minRmsAt,
    silentGapCount: silentWindows.length,
    silentGaps: silentWindows.slice(0, 10),
    aroundCuts,
  };
}
