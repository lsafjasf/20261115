// 样本级 4 路 Hadamard FDN 混响（AudioWorklet）
// 在单个处理器内完成延迟、矩阵混合与阻尼，避免 DelayNode 反馈图在
// 部分浏览器上的数值发散问题。纯算法实现，无卷积。
const N = 4;
const H = [
  [0.5, 0.5, 0.5, 0.5],
  [0.5, -0.5, 0.5, -0.5],
  [0.5, 0.5, -0.5, -0.5],
  [0.5, -0.5, -0.5, 0.5],
];
const MAX_DELAY = 0.85; // 秒，覆盖最长走廊的延迟需求

class ReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const params = [];
    for (let i = 0; i < N; i++) {
      params.push({ name: `delay${i}`, defaultValue: 0.05, minValue: 0.004, maxValue: MAX_DELAY,
                    automationRate: "k-rate" });
      params.push({ name: `gain${i}`, defaultValue: 0.7, minValue: 0, maxValue: 0.999,
                    automationRate: "k-rate" });
    }
    params.push({ name: "cutoff", defaultValue: 4000, minValue: 120, maxValue: 12000,
                  automationRate: "k-rate" });
    return params;
  }

  constructor() {
    super();
    this.buffers = Array.from({ length: N },
      () => new Float64Array(Math.ceil(MAX_DELAY * sampleRate) + 2));
    this.readIdx = new Array(N).fill(0);
    this.lpState = new Array(N).fill(0);
    // 当前生效的延迟采样长度与读写指针
    this.delaySamples = new Array(N).fill(0);
    this.writeIdx = new Array(N).fill(0);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] && inputs[0][0] ? inputs[0][0] : null;
    const out = outputs[0][0];
    const block = out.length;

    const gains = new Array(N);
    for (let i = 0; i < N; i++) {
      this.delaySamples[i] = Math.max(2, Math.round(parameters[`delay${i}`][0] * sampleRate));
      gains[i] = parameters[`gain${i}`][0];
    }
    const cutoff = parameters.cutoff[0];
    // 一阶低通系数必须 < 1，否则反馈状态发散
    const lpA = Math.min(0.95, (2 * Math.PI * cutoff) / sampleRate);

    for (let n = 0; n < block; n++) {
      const u = input ? input[n] : 0;
      const reads = new Array(N);
      for (let i = 0; i < N; i++) {
        // 一阶低通阻尼在读取端
        const raw = this.buffers[i][this.readIdx[i]];
        this.lpState[i] += lpA * (raw - this.lpState[i]);
        reads[i] = this.lpState[i];
      }

      let y = 0;
      for (let i = 0; i < N; i++) y += reads[i];
      out[n] = y;

      for (let j = 0; j < N; j++) {
        let mix = u * 0.25;
        for (let i = 0; i < N; i++) mix += reads[i] * gains[i] * H[i][j];
        const buf = this.buffers[j];
        buf[this.writeIdx[j]] = mix;
        this.writeIdx[j] = (this.writeIdx[j] + 1) % buf.length;
        this.readIdx[j] = (this.writeIdx[j] - this.delaySamples[j] + buf.length * 2) % buf.length;
      }
    }
    return true;
  }
}

registerProcessor("reverb-fdn", ReverbProcessor);
