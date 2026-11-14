/* Procedural WebAudio: engine follows throttle/load, wind follows gusts, seed hiss, slide alarm. */
(function (global) {
  const App = (global.App = global.App || {});

  function createAudio() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    const engineOsc = ctx.createOscillator();
    const engineGain = ctx.createGain();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 60;
    engineGain.gain.value = 0;
    engineOsc.connect(engineGain).connect(master);
    engineOsc.start();

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    function makeNoiseSource() {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      return src;
    }

    const windSrc = makeNoiseSource();
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 480;
    windFilter.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter).connect(windGain).connect(master);
    windSrc.start();

    const seedSrc = makeNoiseSource();
    const seedFilter = ctx.createBiquadFilter();
    seedFilter.type = 'highpass';
    seedFilter.frequency.value = 2600;
    const seedGain = ctx.createGain();
    seedGain.gain.value = 0;
    seedSrc.connect(seedFilter).connect(seedGain).connect(master);
    seedSrc.start();

    let muted = false;
    const audio = {
      resume() {
        if (ctx.state === 'suspended') ctx.resume();
      },
      setMuted(m) {
        muted = m;
        master.gain.value = m ? 0 : 0.5;
      },
      get muted() {
        return muted;
      },
      update(state) {
        const now = ctx.currentTime;
        const load = state.throttle;
        const engineFreq = 55 + state.speed * 14 + load * 40;
        engineOsc.frequency.setTargetAtTime(engineFreq, now, 0.08);
        engineGain.gain.setTargetAtTime(0.05 + load * 0.12 + (state.sliding ? 0.05 : 0), now, 0.1);
        windGain.gain.setTargetAtTime(Math.min(0.22, state.windSpeed * 0.045), now, 0.15);
        windFilter.frequency.setTargetAtTime(380 + state.windSpeed * 60, now, 0.2);
        seedGain.gain.setTargetAtTime(state.sowing ? 0.12 + state.width * 0.004 : 0, now, 0.05);
        if (state.sliding) {
          engineOsc.type = state.sawToggle ? 'square' : 'sawtooth';
        } else {
          engineOsc.type = 'sawtooth';
        }
      },
    };
    return audio;
  }

  App.Audio = { createAudio };
})(typeof globalThis !== 'undefined' ? globalThis : this);
