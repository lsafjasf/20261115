import {
  BARS,
  PPQ,
  TICKS_PER_STEP,
  TOTAL_STEPS,
} from "./constants.js";
import { isTine, trackOf } from "./notes.js";

let noteSeq = 0;

export function createSong(meta = {}) {
  return {
    title: meta.title ?? "未命名曲目",
    titleEn: meta.titleEn ?? "Untitled",
    key: meta.key ?? "D MAJOR",
    timeSignature: meta.timeSignature ?? "4/4",
    bars: BARS,
    bpm: meta.bpm ?? 117,
    ppq: PPQ,
    notes: [],
  };
}

export function addNote(song, { step, midi, duration = 2 }) {
  const track = trackOf(midi);
  if (track === null) throw new Error(`MIDI ${midi} 不在齿片库中`);
  if (!Number.isInteger(step) || step < 0 || step >= TOTAL_STEPS) {
    throw new Error("step 超出 8 小节范围");
  }
  if (!Number.isInteger(duration) || duration < 1 || step + duration > TOTAL_STEPS) {
    throw new Error("音符长度非法或超出结尾");
  }
  const note = {
    id: `n${++noteSeq}_${step}_${midi}`,
    step,
    duration,
    midi,
    track,
  };
  song.notes.push(note);
  return note;
}

export function removeNote(song, id) {
  const idx = song.notes.findIndex((n) => n.id === id);
  if (idx >= 0) song.notes.splice(idx, 1);
  return idx >= 0;
}

export function notesAtStep(song, step) {
  return song.notes.filter((n) => n.step === step);
}

// 同一轨道时间槽冲突检测
export function hasConflict(song, { step, duration, track, midi, ignoreId = null }) {
  return song.notes.some(
    (n) =>
      n.id !== ignoreId &&
      n.track === track &&
      n.midi === midi &&
      n.step < step + duration &&
      step < n.step + n.duration,
  );
}

export function activeNotesAtStep(song, step) {
  return song.notes.filter((n) => n.step <= step && step < n.step + n.duration);
}

// 同时振动的齿片数（只计该步触发的音，用于掩蔽判定）
export function simultaneousAtStep(song, step) {
  return notesAtStep(song, step).length;

}

export function clearSong(song) {
  song.notes = [];
}

// ---- MIDI 风格 JSON 编解码 ----

export function toMidiJSON(song) {
  return {
    format: "tine-music-box/midi-json",
    version: 1,
    ppq: PPQ,
    meta: {
      title: song.title,
      titleEn: song.titleEn,
      key: song.key,
      timeSignature: song.timeSignature,
      bars: BARS,
      bpm: song.bpm,
    },
    tracks: [
      {
        name: "left-comb-low",
        events: song.notes
          .filter((n) => n.track === "left")
          .map((n) => ev(n)),
      },
      {
        name: "right-comb-high",
        events: song.notes
          .filter((n) => n.track === "right")
          .map((n) => ev(n)),
      },
    ],
  };
}

function ev(n) {
  return {
    tick: n.step * TICKS_PER_STEP,
    durationTicks: n.duration * TICKS_PER_STEP,
    midi: n.midi,
    note: n.midi,
  };
}

export function fromMidiJSON(data) {
  if (!data || data.format !== "tine-music-box/midi-json" || !Array.isArray(data.tracks)) {
    throw new Error("不是合法的齿间 MIDI JSON 文件");
  }
  const song = createSong(data.meta || {});
  if (data.ppq) song.ppq = data.ppq;
  const scale = (data.ppq || PPQ) / PPQ;
  for (const tr of data.tracks) {
    for (const e of tr.events ?? []) {
      const step = Math.round(e.tick / (TICKS_PER_STEP * scale));
      const duration = Math.max(1, Math.round(e.durationTicks / (TICKS_PER_STEP * scale)));
      if (!isTine(e.midi) || step < 0 || step >= TOTAL_STEPS) continue;
      addNote(song, { step, midi: e.midi, duration });
    }
  }
  return song;
}

