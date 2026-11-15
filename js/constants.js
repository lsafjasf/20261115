export const BARS = 8;
export const STEPS_PER_BAR = 16; // 4/4 拍，16 分音符网格
export const TOTAL_STEPS = BARS * STEPS_PER_BAR; // 128
export const PPQ = 480; // MIDI 风格每四分音符 tick 数
export const TICKS_PER_STEP = PPQ / 4; // 120

export const MIN_BPM = 60;
export const MAX_BPM = 180;
export const DEFAULT_BPM = 117;

export const MASKING_THRESHOLD = 3; // 超过 3 根齿片同时振动即掩蔽
export const STORAGE_KEY = "tine-music-box:v1";
