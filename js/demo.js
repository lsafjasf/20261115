import { DEFAULT_BPM } from "./constants.js";
import { addNote, createSong } from "./song.js";

// 《苔上星光 / Starlight on Moss》——D 大调，8 小节，40 个音符。
// 左轨 16 个（四分音符），右轨 24 个（八分音符），最密处 2 齿共振，不会掩蔽。
export function buildDemoSong() {
  const song = createSong({
    title: "苔上星光",
    titleEn: "Starlight on Moss",
    key: "D MAJOR",
    bpm: DEFAULT_BPM,
  });

  const rightLine = [
    [0, 74], [4, 76], [12, 74],
    [16, 78], [20, 76], [28, 74],
    [32, 81], [36, 78], [44, 76],
    [48, 74], [52, 76], [60, 78],
    [64, 83], [68, 81], [76, 78],
    [80, 76], [84, 74], [92, 71],
    [96, 74], [100, 76], [108, 78],
    [112, 81], [116, 78], [124, 74],
  ];
  for (const [step, midi] of rightLine) addNote(song, { step, midi, duration: 2 });

  const leftLine = [
    [0, 50], [8, 55],
    [16, 52], [24, 57],
    [32, 50], [40, 55],
    [48, 55], [56, 50],
    [64, 57], [72, 54],
    [80, 55], [88, 50],
    [96, 52], [104, 55],
    [112, 50], [120, 50],
  ];
  for (const [step, midi] of leftLine) addNote(song, { step, midi, duration: 4 });

  return song;
}
