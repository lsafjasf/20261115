export const PROJECT = Object.freeze({
  id: "eight-flash-30s-v1",
  name: "EIGHT / FLASH",
  durationSec: 30,
  fps: 30,
  width: 960,
  height: 540,
  beatIntervalSec: 0.6,
  maxOffsetMs: 300,
});

export const TOTAL_FRAMES = PROJECT.durationSec * PROJECT.fps;
export const MAX_OFFSET_FRAMES = Math.round(
  (PROJECT.maxOffsetMs / 1000) * PROJECT.fps,
);

const ACCENT_TIMES = [1.2, 4.8, 8.4, 12.0, 15.6, 19.2, 22.8, 26.4];
const FLASH_TITLES = [
  "COLD BLOOM",
  "HOT CUT",
  "WHITE OUT",
  "RED SHIFT",
  "PRISM",
  "BLACK SUN",
  "LAST SIGNAL",
  "FINAL PULSE",
];
const FLASH_COLORS = [
  "#5ce1e6",
  "#ff8b5c",
  "#f4f5f7",
  "#ff5f68",
  "#a99cff",
  "#d7ff45",
  "#5ce1e6",
  "#ffb45c",
];

export const AUDIO_EVENTS = Object.freeze(
  ACCENT_TIMES.map((timeSec, index) =>
    Object.freeze({
      id: `accent-${String(index + 1).padStart(2, "0")}`,
      index,
      timeSec,
      frame: Math.round(timeSec * PROJECT.fps),
      kind: "accent",
      label: `FLARE ${String(index + 1).padStart(2, "0")}`,
    }),
  ),
);

export const FLASHES = Object.freeze(
  AUDIO_EVENTS.map((event) =>
    Object.freeze({
      ...event,
      id: `flash-${String(event.index + 1).padStart(2, "0")}`,
      title: FLASH_TITLES[event.index],
      color: FLASH_COLORS[event.index],
    }),
  ),
);

export const BEAT_EVENTS = Object.freeze(
  Array.from(
    { length: Math.round(PROJECT.durationSec / PROJECT.beatIntervalSec) },
    (_, index) =>
      Object.freeze({
        id: `beat-${String(index + 1).padStart(3, "0")}`,
        index,
        timeSec: Number((index * PROJECT.beatIntervalSec).toFixed(6)),
        isBar: index % 6 === 0,
      }),
  ),
);

export const ALL_AUDIO_EVENTS = Object.freeze(
  [...BEAT_EVENTS, ...AUDIO_EVENTS].sort((a, b) => a.timeSec - b.timeSec),
);

export function clampOffsetFrames(value) {
  return Math.max(-MAX_OFFSET_FRAMES, Math.min(MAX_OFFSET_FRAMES, Math.round(value)));
}

export function offsetFramesToMs(frames) {
  return (frames * 1000) / PROJECT.fps;
}

export function offsetFramesToSec(frames) {
  return frames / PROJECT.fps;
}

export function formatTime(seconds, withMs = true) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000) % 1000;
  const base = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return withMs ? `${base}.${String(ms).padStart(3, "0")}` : base;
}

export function formatOffset(frames) {
  const ms = offsetFramesToMs(frames);
  const rounded = Math.abs(ms - Math.round(ms)) < 0.001 ? Math.round(ms) : ms.toFixed(1);
  if (frames === 0) return "0";
  return `${frames > 0 ? "+" : "−"}${Math.abs(rounded)}`;
}

export function projectStateHash(offsetFrames) {
  const input = [
    PROJECT.id,
    PROJECT.durationSec,
    PROJECT.fps,
    offsetFrames,
    AUDIO_EVENTS.map((event) => event.timeSec).join(","),
  ].join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}
