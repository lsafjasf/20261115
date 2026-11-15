/* Web Audio：泵嗡鸣、继电器咔哒、闸门闷响、越限警报、恢复提示音 */
(function (root) {
  'use strict';

  function createAudio() {
    var ctx = null;
    var pumpOsc = null, pumpGain = null, pumpFilter = null;
    var alarmOsc = null, alarmGain = null, alarmLfo = null, alarmLfoGain = null;
    var master = null;

    function init() {
      if (ctx) return;
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);

      // 泵：锯齿波 + 低通，音高随压力、响度随转速
      pumpOsc = ctx.createOscillator();
      pumpOsc.type = 'sawtooth';
      pumpOsc.frequency.value = 48;
      pumpFilter = ctx.createBiquadFilter();
      pumpFilter.type = 'lowpass';
      pumpFilter.frequency.value = 220;
      pumpGain = ctx.createGain();
      pumpGain.gain.value = 0;
      pumpOsc.connect(pumpFilter).connect(pumpGain).connect(master);
      pumpOsc.start();

      // 警报：方波双音交替（LFO 调制频率）
      alarmOsc = ctx.createOscillator();
      alarmOsc.type = 'square';
      alarmOsc.frequency.value = 620;
      alarmLfo = ctx.createOscillator();
      alarmLfo.type = 'square';
      alarmLfo.frequency.value = 3.5;
      alarmLfoGain = ctx.createGain();
      alarmLfoGain.gain.value = 110;
      alarmLfo.connect(alarmLfoGain).connect(alarmOsc.frequency);
      alarmGain = ctx.createGain();
      alarmGain.gain.value = 0;
      alarmOsc.connect(alarmGain).connect(master);
      alarmOsc.start();
      alarmLfo.start();
    }

    function blip(freq, dur, type, vol) {
      if (!ctx) return;
      var o = ctx.createOscillator();
      o.type = type || 'square';
      o.frequency.value = freq;
      var g = ctx.createGain();
      g.gain.setValueAtTime(vol || 0.2, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g).connect(master);
      o.start();
      o.stop(ctx.currentTime + dur);
    }

    function clunk() { // 闸门闷响：低频噪声感
      if (!ctx) return;
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.18);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.35, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      o.connect(g).connect(master);
      o.start();
      o.stop(ctx.currentTime + 0.22);
    }

    function chime() { // 设备组恢复：双音上行
      blip(523, 0.25, 'sine', 0.25);
      setTimeout(function () { blip(784, 0.35, 'sine', 0.25); }, 140);
    }

    function failTone() {
      if (!ctx) return;
      var o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(300, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 1.2);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.3, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.3);
      o.connect(g).connect(master);
      o.start();
      o.stop(ctx.currentTime + 1.3);
    }

    function winChord() {
      [523, 659, 784].forEach(function (f, i) {
        setTimeout(function () { blip(f, 0.6, 'sine', 0.22); }, i * 120);
      });
    }

    // 每帧更新连续参数
    function update(st) {
      if (!ctx) return;
      var t = ctx.currentTime;
      var pumpOn = st.pumpSpeed > 0.02;
      pumpGain.gain.setTargetAtTime(pumpOn ? 0.16 * st.pumpSpeed : 0, t, 0.1);
      pumpOsc.frequency.setTargetAtTime(48 + 26 * st.pressure / 10, t, 0.15);
      var danger = st.status === 'running' && (!st.pressureOk || !st.voltageOk);
      alarmGain.gain.setTargetAtTime(danger ? 0.07 : 0, t, 0.08);
    }

    // 根据仿真事件触发一次性音效
    function notify(ev) {
      if (!ctx) return;
      switch (ev.type) {
        case 'input':
          if (ev.msg.indexOf('继电器') >= 0 || ev.msg.indexOf('断路器') >= 0) blip(1250, 0.05, 'square', 0.18);
          else if (ev.msg.indexOf('闸门') >= 0) clunk();
          else blip(300, 0.12, 'triangle', 0.2);
          break;
        case 'spike': blip(180, 0.3, 'sawtooth', 0.25); break;
        case 'restored': chime(); break;
        case 'overpressure': failTone(); break;
        case 'won': winChord(); break;
      }
    }

    return { init: init, update: update, notify: notify };
  }

  root.GameAudio = { create: createAudio };
})(typeof self !== 'undefined' ? self : this);
