// 音片库：左轨低音齿 9 根，右轨高音齿 10 根（D 大调常用音 + 左轨 C3/E3 经过音）

export const LEFT_TINES = [
  { midi: 48, name: "C3" },
  { midi: 50, name: "D3" },
  { midi: 52, name: "E3" },
  { midi: 54, name: "F#3" },
  { midi: 55, name: "G3" },
  { midi: 57, name: "A3" },
  { midi: 59, name: "B3" },
  { midi: 62, name: "D4" },
  { midi: 64, name: "E4" },
];

export const RIGHT_TINES = [
  { midi: 67, name: "G4" },
  { midi: 69, name: "A4" },
  { midi: 71, name: "B4" },
  { midi: 74, name: "D5" },
  { midi: 76, name: "E5" },
  { midi: 78, name: "F#5" },
  { midi: 81, name: "A5" },
  { midi: 83, name: "B5" },
  { midi: 86, name: "D6" },
  { midi: 88, name: "E6" },
];

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[((midi % 12) + 12) % 12] + octave;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const LEFT_MIDIS = new Set(LEFT_TINES.map((t) => t.midi));
const RIGHT_MIDIS = new Set(RIGHT_TINES.map((t) => t.midi));

export function trackOf(midi) {
  if (LEFT_MIDIS.has(midi)) return "left";
  if (RIGHT_MIDIS.has(midi)) return "right";
  return null;
}

export function isTine(midi) {
  return trackOf(midi) !== null;
}

export function tinesOf(track) {
  return track === "left" ? LEFT_TINES : RIGHT_TINES;
}
