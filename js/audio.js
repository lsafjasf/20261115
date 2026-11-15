// Web Audio：擒纵节拍声 + 随转速变化的齿轮嗡鸣
export function createAudio() {
  let ctx = null;
  let humOsc = null;
  let humGain = null;
  let enabled = false;

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      humOsc = ctx.createOscillator();
      humOsc.type = 'sawtooth';
      humGain = ctx.createGain();
      humGain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      humOsc.connect(lp).connect(humGain).connect(ctx.destination);
      humOsc.start();
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  return {
    setEnabled(on) {
      enabled = on;
      if (on) ensure();
      if (!on && humGain) humGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    },
    // 每拍滴答：短促方波脉冲
    tick() {
      if (!enabled || !ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 2200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.05);
    },
    // 嗡鸣频率/响度随擒纵轮转速变化
    update(escapeRpm, ramp) {
      if (!enabled || !ctx || !humOsc) return;
      const t = ctx.currentTime;
      humOsc.frequency.setTargetAtTime(40 + escapeRpm * 12, t, 0.08);
      humGain.gain.setTargetAtTime(0.015 + 0.05 * ramp, t, 0.1);
    },
  };
}
