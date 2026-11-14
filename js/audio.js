/* 声音层：风噪随风力 / 摆动滑音 / 急停撞击 / 投递提示，均由 Web Audio 合成 */
(function () {
  'use strict';

  function createAudio() {
    let ctx = null, master, windGain, windFilter, swingOsc, swingGain;
    let started = false, muted = false;

    function ensure() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);

      /* 风：滤波白噪声 */
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf; noise.loop = true;
      windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 480;
      windFilter.Q.value = 0.8;
      windGain = ctx.createGain();
      windGain.gain.value = 0;
      noise.connect(windFilter).connect(windGain).connect(master);
      noise.start();

      /* 摆动：持续低频振荡器，频率随摆角偏移 */
      swingOsc = ctx.createOscillator();
      swingOsc.type = 'sine';
      swingOsc.frequency.value = 120;
      swingGain = ctx.createGain();
      swingGain.gain.value = 0;
      swingOsc.connect(swingGain).connect(master);
      swingOsc.start();
      started = true;
    }

    function resume() {
      ensure();
      if (ctx.state === 'suspended') ctx.resume();
    }

    function blip(freq, dur, type, vol, slideTo) {
      if (!started || muted) return;
      const o = ctx.createOscillator();
      const gn = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
      gn.gain.setValueAtTime(vol || 0.25, ctx.currentTime);
      gn.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(gn).connect(master);
      o.start();
      o.stop(ctx.currentTime + dur);
    }

    return {
      unlock() { resume(); },
      setMuted(m) {
        muted = m;
        if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
      },
      isMuted() { return muted; },
      /* 每帧驱动：wind 风力，theta/omega 摆动量，estop 急停，speed 车速 */
      update(state) {
        if (!started) return;
        const wmag = Math.min(1, Math.abs(state.wind) / 160);
        windGain.gain.setTargetAtTime(0.02 + wmag * 0.16, ctx.currentTime, 0.1);
        windFilter.frequency.setTargetAtTime(340 + wmag * 760, ctx.currentTime, 0.12);
        const swing = Math.min(1, Math.abs(state.theta) * 2.2 + Math.abs(state.omega) * 0.4);
        swingGain.gain.setTargetAtTime(swing * 0.07, ctx.currentTime, 0.08);
        swingOsc.frequency.setTargetAtTime(
          105 + Math.abs(state.theta) * 260 + Math.min(1, Math.abs(state.speed) / 160) * 40,
          ctx.currentTime, 0.06
        );
        if (state.estop) this.crash();
      },
      crash() { blip(150, 0.32, 'sawtooth', 0.32, 46); },
      spill() { blip(660, 0.12, 'triangle', 0.14, 420); },
      deliver() {
        blip(523, 0.14, 'sine', 0.25);
        setTimeout(() => blip(784, 0.22, 'sine', 0.25), 130);
      },
      win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.3, 'sine', 0.28), i * 170)); },
      lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => blip(f, 0.35, 'triangle', 0.26), i * 210)); },
    };
  }

  window.CliffAudio = { createAudio };
})();
