export const SCENE_DURATION_MS = 8000;
export const MAX_DELAY_MS = 1200;
export const DELAY_STEP_MS = 20;
export const ENTRANCE_MS = 900;

export const TRACKS = [
  {
    id: "ember",
    number: "01",
    name: "烬火",
    englishName: "EMBER",
    kind: "LOW PULSE",
    color: "#ff6a46",
    baseOffsetMs: 0,
    durationMs: 6400,
    peakDb: -3.4,
    intervalMs: 800
  },
  {
    id: "air",
    number: "02",
    name: "流风",
    englishName: "AIR",
    kind: "GLASS ARP",
    color: "#f0d257",
    baseOffsetMs: 600,
    durationMs: 5800,
    peakDb: -6.2,
    intervalMs: 650
  },
  {
    id: "tide",
    number: "03",
    name: "潮汐",
    englishName: "TIDE",
    kind: "FILTERED BASS",
    color: "#49d1c3",
    baseOffsetMs: 1200,
    durationMs: 4800,
    peakDb: -4.6,
    intervalMs: 960
  },
  {
    id: "prism",
    number: "04",
    name: "棱镜",
    englishName: "PRISM",
    kind: "FM BELL",
    color: "#a49aff",
    baseOffsetMs: 1800,
    durationMs: 3800,
    peakDb: -7.8,
    intervalMs: 1100
  }
];

export const DEFAULT_SETTINGS = {
  delaysMs: Object.fromEntries(TRACKS.map((track) => [track.id, 0])),
  muted: Object.fromEntries(TRACKS.map((track) => [track.id, false])),
  masterVolume: 0.68,
  loop: false
};

export function actualOffsetMs(track, delayMs) {
  return track.baseOffsetMs + delayMs;
}

export function formatSeconds(seconds, precision = 3) {
  return `${seconds.toFixed(precision)}s`;
}
