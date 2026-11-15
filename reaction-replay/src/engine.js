// Pure game engine: no DOM, fully deterministic given (seed, input stream).
// One call to step() advances exactly one fixed tick.

import { mulberry32, nextRange } from './rng.js';

export const CONFIG = {
  tickMs: 1000 / 30,
  totalTicks: 30 * 20, // 20 seconds at 30 ticks/s
  fieldWidth: 400,
  fieldHeight: 520,
  targetRadius: 22,
  minTtlTicks: 35,
  maxTtlTicks: 55,
  minCooldownTicks: 8,
  maxCooldownTicks: 22,
  hitBaseScore: 10,
  missPenalty: 2,
};

export function createEngine(seed) {
  const rng = mulberry32(seed);
  const state = {
    seed: seed >>> 0,
    tick: 0,
    score: 0,
    hits: 0,
    misses: 0,
    target: null,
    cooldown: 0,
    status: 'running',
  };

  function spawnTarget() {
    const r = CONFIG.targetRadius;
    const x = nextRange(rng, r + 8, CONFIG.fieldWidth - r - 8);
    const y = nextRange(rng, r + 8, CONFIG.fieldHeight - r - 8);
    const ttl =
      CONFIG.minTtlTicks +
      Math.floor(rng.next() * (CONFIG.maxTtlTicks - CONFIG.minTtlTicks + 1));
    state.target = { x, y, bornTick: state.tick, ttlTicks: ttl };
  }

  function step(input) {
    const events = [];
    if (state.status !== 'running') return events;

    // 1. Resolve the player's click for this tick.
    if (input && input.clicked && state.target) {
      const dx = input.x - state.target.x;
      const dy = input.y - state.target.y;
      const hit = dx * dx + dy * dy <= CONFIG.targetRadius * CONFIG.targetRadius;
      if (hit) {
        const age = state.tick - state.target.bornTick;
        const bonus = Math.max(0, state.target.ttlTicks - age);
        state.score += CONFIG.hitBaseScore + Math.floor(bonus / 10);
        state.hits += 1;
        state.target = null;
        state.cooldown =
          CONFIG.minCooldownTicks +
          Math.floor(rng.next() * (CONFIG.maxCooldownTicks - CONFIG.minCooldownTicks + 1));
        events.push({ type: 'hit', x: input.x, y: input.y });
      } else {
        state.score = Math.max(0, state.score - CONFIG.missPenalty);
        state.misses += 1;
        events.push({ type: 'miss', x: input.x, y: input.y });
      }
    } else if (input && input.clicked) {
      state.score = Math.max(0, state.score - CONFIG.missPenalty);
      state.misses += 1;
      events.push({ type: 'miss', x: input.x, y: input.y });
    }

    // 2. Expire an aged-out target.
    if (state.target) {
      const age = state.tick - state.target.bornTick;
      if (age >= state.target.ttlTicks) {
        state.target = null;
        state.cooldown =
          CONFIG.minCooldownTicks +
          Math.floor(rng.next() * (CONFIG.maxCooldownTicks - CONFIG.minCooldownTicks + 1));
        events.push({ type: 'expire' });
      }
    }

    // 3. Spawn a new target when the field is empty and cooldown elapsed.
    if (!state.target) {
      if (state.cooldown > 0) state.cooldown -= 1;
      if (state.cooldown === 0) {
        spawnTarget();
        events.push({ type: 'spawn', target: { ...state.target } });
      }
    }

    // 4. Advance the clock.
    state.tick += 1;
    if (state.tick >= CONFIG.totalTicks) state.status = 'finished';
    return events;
  }

  return {
    state,
    rng,
    step,
  };
}

// Plain, JSON-safe snapshot used for replay comparisons.
export function snapshotState(state, rngState) {
  return {
    tick: state.tick,
    score: state.score,
    hits: state.hits,
    misses: state.misses,
    cooldown: state.cooldown,
    status: state.status,
    rng: rngState >>> 0,
    target: state.target ? { ...state.target } : null,
  };
}
