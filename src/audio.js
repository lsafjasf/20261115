// Web Audio 机械音效：根据负载比改变电机音高，事件给短促提示音。

export class CraneAudio {
  constructor() {
    this.ctx = null;
    this.motor = null;
    this.motorGain = null;
    this.muted = false;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();

    const motor = this.ctx.createOscillator();
    const sub = this.ctx.createOscillator();
    const motorGain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    motor.type = "sawtooth";
    sub.type = "triangle";
    motor.frequency.value = 70;
    sub.frequency.value = 35;
    filter.type = "lowpass";
    filter.frequency.value = 420;
    motorGain.gain.value = 0;
    motor.connect(filter);
    sub.connect(filter);
    filter.connect(motorGain);
    motorGain.connect(this.ctx.destination);
    motor.start();
    sub.start();
    this.motor = motor;
    this.sub = sub;
    this.filter = filter;
    this.motorGain = motorGain;
  }

  // loadRatio 0..1，moving 表示是否有操作输入。
  update(loadRatio, moving) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const targetFreq = 62 + loadRatio * 58;
    const targetGain = moving ? 0.05 + loadRatio * 0.04 : 0.018;
    this.motor.frequency.setTargetAtTime(targetFreq, now, 0.08);
    this.sub.frequency.setTargetAtTime(targetFreq / 2, now, 0.08);
    this.filter.frequency.setTargetAtTime(360 + loadRatio * 520, now, 0.1);
    this.motorGain.gain.setTargetAtTime(targetGain, now, 0.12);
  }

  blip(frequency, duration = 0.12, type = "square", volume = 0.08) {
    if (!this.ctx || this.muted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  handleEvent(event) {
    switch (event.type) {
      case "attached":
        this.blip(440, 0.1, "square", 0.06);
        break;
      case "delivered":
        this.blip(660, 0.16, "triangle", 0.09);
        setTimeout(() => this.blip(880, 0.18, "triangle", 0.08), 110);
        break;
      case "capsize":
        this.blip(110, 0.7, "sawtooth", 0.12);
        break;
      case "sunk":
        this.blip(160, 0.4, "sine", 0.1);
        break;
      default:
        break;
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.motorGain && this.ctx) {
      this.motorGain.gain.setTargetAtTime(
        muted ? 0 : 0.02,
        this.ctx.currentTime,
        0.05
      );
    }
  }
}
