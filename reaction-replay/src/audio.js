// Thin Web Audio wrapper for operation feedback. The AudioContext is created
// lazily on the first user gesture, as browsers require.

export function createFeedback() {
  let ctx = null;

  function ensure() {
    try {
      if (!ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        ctx = new Ctor();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  }

  function tone(freq, duration, type = 'sine', gainValue = 0.08, when = 0) {
    const ac = ensure();
    if (!ac) return;
    const t0 = ac.currentTime + when;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainValue, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  return {
    unlock() {
      ensure();
    },
    hit() {
      tone(880, 0.09, 'triangle', 0.1);
      tone(1320, 0.08, 'triangle', 0.06, 0.03);
    },
    miss() {
      tone(180, 0.16, 'sawtooth', 0.07);
    },
    expire() {
      tone(320, 0.12, 'square', 0.05);
    },
    finish() {
      tone(660, 0.12, 'triangle', 0.09);
      tone(990, 0.16, 'triangle', 0.08, 0.1);
    },
    alarm() {
      tone(520, 0.1, 'square', 0.08);
      tone(390, 0.14, 'square', 0.08, 0.12);
    },
  };
}
