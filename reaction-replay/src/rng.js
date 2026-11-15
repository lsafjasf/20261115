// Deterministic 32-bit PRNG (mulberry32). State is a single uint32 so it can
// be snapshotted into the replay log and restored byte-for-byte on replay.

export function mulberry32(seed) {
  let state = seed >>> 0;
  return {
    get state() {
      return state >>> 0;
    },
    set state(value) {
      state = value >>> 0;
    },
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

// Range [min, max)
export function nextRange(rng, min, max) {
  return min + rng.next() * (max - min);
}
