// audio.js — WebAudio 节拍轨:120 BPM 底鼓 + 每拍嘀嗒,切镜处加重音。
// 节拍时间轴与世界时间 t 对齐:第 n 拍在 t = n * 60/bpm 秒。
(function (global) {
  function createBeatTrack(audioCtx, project) {
    const master = audioCtx.createGain();
    master.gain.value = 0.9;

    function kick(when, gainVal) {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, when);
      osc.frequency.exponentialRampToValueAtTime(48, when + 0.1);
      g.gain.setValueAtTime(gainVal, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.16);
      osc.connect(g); g.connect(master);
      osc.start(when); osc.stop(when + 0.2);
    }

    function tick(when, gainVal, freq) {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(gainVal, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
      osc.connect(g); g.connect(master);
      osc.start(when); osc.stop(when + 0.06);
    }

    // 从世界时间 t0 对应的音频时刻 audioT0 开始,调度整段节目的节拍
    function schedule(audioT0, worldT0) {
      const bpm = project.audio.bpm;
      const spb = 60 / bpm;
      const dur = project.duration;
      const firstBeat = Math.ceil(worldT0 / spb - 1e-6);
      const total = Math.floor(dur / spb);
      for (let n = firstBeat; n <= total; n++) {
        const tWorld = n * spb;
        if (tWorld > dur) break;
        const when = audioT0 + (tWorld - worldT0);
        const isBar = n % project.audio.beatsPerBar === 0;
        kick(when, isBar ? 0.9 : 0.55);
        tick(when, isBar ? 0.25 : 0.12, isBar ? 1960 : 1320);
      }
      // 切镜重音(镲片噪声)
      for (const s of project.shots) {
        if (s.start <= worldT0 || s.start >= dur) continue;
        const when = audioT0 + (s.start - worldT0);
        const len = 0.25;
        const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * len, audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.35, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + len);
        const filt = audioCtx.createBiquadFilter();
        filt.type = 'highpass'; filt.frequency.value = 5000;
        src.connect(filt); filt.connect(g); g.connect(master);
        src.start(when);
      }
    }

    return { master, schedule };
  }

  global.BeatTrack = { createBeatTrack };
})(typeof window !== 'undefined' ? window : globalThis);
