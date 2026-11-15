// Deterministic pseudo-random generator so a seed always rebuilds the same city.
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const rand = mulberry32(seed);
  return {
    next: rand,
    range(min, max) {
      return min + rand() * (max - min);
    },
    int(min, max) {
      return Math.floor(rand() * (max - min + 1)) + min;
    },
    pick(arr) {
      return arr[Math.floor(rand() * arr.length)];
    },
  };
}
