/* Deterministic PRNG (mulberry32) so a fixed seed reproduces the whole round. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  constructor(seed) {
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
  }
  float() {
    return this._next();
  }
  int(min, maxInclusive) {
    return min + Math.floor(this.float() * (maxInclusive - min + 1));
  }
  pick(array) {
    return array[Math.floor(this.float() * array.length)];
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { Rng, mulberry32 };
}
