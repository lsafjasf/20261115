// Deterministic auto-player: aims at the current target and reacts after a
// short human-like delay, clicking roughly every 7 ticks while a target is up.

export function decideInput(state) {
  if (!state.target) return { clicked: false, x: 0, y: 0 };
  const age = state.tick - state.target.bornTick;
  // Wait a beat (reaction time), then click on the target center.
  if (age >= 4 && age % 7 === 0) {
    return {
      clicked: true,
      x: Math.round(state.target.x),
      y: Math.round(state.target.y),
    };
  }
  return { clicked: false, x: 0, y: 0 };
}
