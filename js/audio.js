/* Procedural ice-stress audio. Pitch / filter track local thin-ice stress. */
(function (global) {
  function createAudio() {
    let ctx = null, osc, sub, filter, gain, started = false;

    function ensure() {
      if (started) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      osc = ctx.createOscillator();
      sub = ctx.createOscillator();
      filter = ctx.createBiquadFilter();
      gain = ctx.createGain();
      osc.type = 'sine';
      sub.type = 'triangle';
      filter.type = 'lowpass';
      filter.frequency.value = 500;
      gain.gain.value = 0.0001;
      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      sub.start();
      started = true;
    }

    /* stress: 0..1 local ice load; speed: current sphere speed. */
    function update(stress, speed, dt) {
      if (!started || !ctx) return;
      const targetGain = stress > 0.02 ? 0.02 + stress * 0.1 : 0.0001;
      const now = ctx.currentTime;
      gain.gain.setTargetAtTime(targetGain, now, 0.1);
      osc.frequency.setTargetAtTime(180 + stress * 520 + speed * 0.4, now, 0.08);
      sub.frequency.setTargetAtTime(90 + stress * 200, now, 0.12);
      filter.frequency.setTargetAtTime(400 + stress * 2600, now, 0.1);
    }

    function blip(freq, dur, vol) {
      if (!started || !ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.08, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (dur || 0.15));
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + (dur || 0.15));
    }

    return {
      ensure,
      update,
      measure: () => blip(660, 0.18, 0.07),
      crack: () => blip(140, 0.3, 0.12),
      win: () => { blip(523, 0.15, 0.09); setTimeout(() => blip(784, 0.3, 0.09), 160); },
      get started() { return started; }
    };
  }

  globalThis.IceAudio = { createAudio };
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.IceAudio;
})(globalThis);
