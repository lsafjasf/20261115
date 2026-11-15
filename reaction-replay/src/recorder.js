// Records every tick into a JSON-safe log with a hash chain, replays the input
// stream from the initial state, and locates the first diverging tick.

import { createEngine, snapshotState, CONFIG } from './engine.js';

// FNV-1a 32-bit, stable across runtimes for short JSON strings.
export function fnv1a(text, previous = 0x811c9dc5) {
  let hash = previous >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function emptyInput() {
  return { clicked: false, x: 0, y: 0 };
}

export function createRecorder(seed) {
  const engine = createEngine(seed);
  const entries = [];
  let prevHash = 0x811c9dc5;

  function recordTick(input) {
    const tickBefore = engine.state.tick;
    const rngBefore = engine.rng.state;
    const safeInput = input ? { clicked: !!input.clicked, x: input.x | 0, y: input.y | 0 } : emptyInput();
    const events = engine.step(safeInput);
    const stateAfter = snapshotState(engine.state, engine.rng.state);

    const body = {
      tick: tickBefore,
      rngBefore,
      input: safeInput,
      rngAfter: engine.rng.state,
      state: stateAfter,
      events,
    };
    const hash = fnv1a(JSON.stringify(body), prevHash);
    prevHash = hash;
    entries.push({ ...body, hash });
    return { events, state: stateAfter };
  }

  function finish() {
    const finalState = snapshotState(engine.state, engine.rng.state);
    const summary = {
      seed: engine.state.seed,
      totalTicks: CONFIG.totalTicks,
      finalTick: finalState.tick,
      finalScore: finalState.score,
      hits: finalState.hits,
      misses: finalState.misses,
      status: finalState.status,
      lastHash: prevHash,
    };
    return {
      version: 1,
      seed: engine.state.seed,
      config: { ...CONFIG },
      summary,
      entries,
    };
  }

  return {
    get state() {
      return engine.state;
    },
    get finished() {
      return engine.state.status === 'finished';
    },
    recordTick,
    finish,
  };
}

function statesEqual(replayed, logged) {
  return (
    replayed.tick === logged.tick &&
    replayed.score === logged.score &&
    replayed.hits === logged.hits &&
    replayed.misses === logged.misses &&
    replayed.cooldown === logged.cooldown &&
    replayed.status === logged.status &&
    replayed.rng === logged.rng &&
    JSON.stringify(replayed.target) === JSON.stringify(logged.target)
  );
}

// Replays every logged input on a fresh engine and compares against the log.
// Returns a detailed report; firstDivergence is null when the log is faithful.
export function replayAndVerify(log) {
  const engine = createEngine(log.seed);
  const hashReport = verifyHashChain(log);
  let firstDivergence = null;
  const checked = [];

  for (const entry of log.entries) {
    const rngBefore = engine.rng.state;
    if (firstDivergence === null && rngBefore !== entry.rngBefore) {
      firstDivergence = {
        tick: entry.tick,
        field: 'rngBefore',
        expected: entry.rngBefore,
        actual: rngBefore,
      };
    }

    engine.step(entry.input || emptyInput());
    const replayed = snapshotState(engine.state, engine.rng.state);

    if (firstDivergence === null && !statesEqual(replayed, entry.state)) {
      firstDivergence = {
        tick: entry.tick,
        field: 'state',
        expected: entry.state,
        actual: replayed,
      };
    }
    checked.push(replayed);
  }

  const finalState = checked[checked.length - 1];
  const s = log.summary;
  const summaryMatches =
    finalState &&
    finalState.score === s.finalScore &&
    finalState.hits === s.hits &&
    finalState.misses === s.misses &&
    finalState.tick === s.finalTick &&
    finalState.status === s.status;

  return {
    faithful: firstDivergence === null && !!summaryMatches && hashReport.intact,
    summaryMatches: !!summaryMatches,
    firstDivergence,
    hashChain: hashReport,
    replayedFinalState: finalState,
  };
}

// Independent structural check over the hash chain.
export function verifyHashChain(log) {
  let prevHash = 0x811c9dc5;
  for (let i = 0; i < log.entries.length; i += 1) {
    const entry = log.entries[i];
    const { hash, ...body } = entry;
    const computed = fnv1a(JSON.stringify(body), prevHash);
    if (computed !== hash) {
      return { intact: false, firstBadIndex: i, firstBadTick: entry.tick };
    }
    prevHash = hash;
  }
  const intact = prevHash === log.summary.lastHash;
  return { intact, firstBadIndex: intact ? -1 : log.entries.length - 1, firstBadTick: intact ? -1 : log.entries[log.entries.length - 1].tick };
}
