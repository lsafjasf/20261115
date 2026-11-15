// 重新载入 VTT / WAV / 工程 JSON，检查三种文件长度与内容一致，并验证播放同步。
const fs = require('fs');
const path = require('path');
const {
  parseWebVtt,
  parseWav,
  parseProjectJSON,
  detectBeepTimes,
  simulatePlayback,
  SAMPLE_RATE,
} = require('../subtitle_studio');

const OUT_DIR = path.join(__dirname, '..', 'output');

function assert(condition, message) {
  if (!condition) throw new Error(`校验失败: ${message}`);
  console.log(`  [通过] ${message}`);
}

function main() {
  const vttText = fs.readFileSync(path.join(OUT_DIR, 'subtitles.vtt'), 'utf8');
  const jsonText = fs.readFileSync(path.join(OUT_DIR, 'project.json'), 'utf8');
  const wavBytes = new Uint8Array(fs.readFileSync(path.join(OUT_DIR, 'rhythm.wav')));

  console.log('1) 重新载入三种导出文件');
  const vttCues = parseWebVtt(vttText);
  const project = parseProjectJSON(jsonText);
  const wav = parseWav(wavBytes);
  const jsonCues = project.sortedCues();

  console.log('2) 条目数量一致');
  assert(vttCues.length === 6, `WebVTT 含 ${vttCues.length} 条字幕（期望 6）`);
  assert(jsonCues.length === 6, `工程 JSON 含 ${jsonCues.length} 条字幕（期望 6）`);
  assert(vttCues.length === jsonCues.length, 'VTT 与 JSON 字幕数量相同');

  console.log('3) 逐条内容与时间点一致');
  for (let i = 0; i < jsonCues.length; i += 1) {
    const fromJson = jsonCues[i];
    const fromVtt = vttCues[i];
    assert(fromVtt.start === fromJson.start, `第${i + 1}条入点一致 ${fromJson.start}ms`);
    assert(fromVtt.end === fromJson.end, `第${i + 1}条出点一致 ${fromJson.end}ms`);
    assert(fromVtt.text === fromJson.text, `第${i + 1}条文本一致: ${fromJson.text}`);
  }

  console.log('4) WAV 长度与视频时长一致，格式为 48kHz/16bit/单声道');
  const expectedSamples = Math.round((project.durationMs / 1000) * SAMPLE_RATE);
  assert(wav.fmt.sampleRate === SAMPLE_RATE, `采样率 ${wav.fmt.sampleRate}Hz`);
  assert(wav.fmt.channels === 1, '单声道');
  assert(wav.fmt.bitsPerSample === 16, '16-bit PCM');
  assert(wav.samples.length === expectedSamples,
    `WAV 采样数 ${wav.samples.length} == 期望 ${expectedSamples}`);
  assert(Math.abs(wav.durationMs - project.durationMs) <= 1,
    `WAV 时长 ${wav.durationMs}ms 与工程 ${project.durationMs}ms 一致`);
  assert(wavBytes.length === 44 + expectedSamples * 2,
    `WAV 字节长度 ${wavBytes.length} 与头部+数据计算值一致`);

  console.log('5) 提示音数量/时刻与每条字幕入出点严格对应');
  // 同一边界（如断句处的出点+入点）合并为一个节奏点。
  const expectedBeeps = [...new Set(jsonCues.flatMap((cue) => [cue.start, cue.end]))]
    .sort((a, b) => a - b);
  const detected = detectBeepTimes(project.durationMs, jsonCues);
  assert(detected.length === expectedBeeps.length,
    `检测到 ${detected.length} 个提示音，期望 ${expectedBeeps.length} 个`);
  for (let i = 0; i < expectedBeeps.length; i += 1) {
    const drift = Math.abs(detected[i] - expectedBeeps[i]);
    assert(drift <= 15, `提示音 #${i + 1} 对齐 ${expectedBeeps[i]}ms（偏差 ${drift}ms）`);
  }

  console.log('6) 模拟播放头推进：文字命中区间与时间轴严格同步');
  const { frames, beepTimes } = simulatePlayback(project, 40);
  let visibleFrames = 0;
  let mismatches = 0;
  for (const frame of frames) {
    const owner = project.activeCueAt(frame.timeMs);
    const expectedText = owner ? owner.text : null;
    if (frame.activeText !== expectedText) mismatches += 1;
    if (owner) visibleFrames += 1;
  }
  assert(mismatches === 0, `全部 ${frames.length} 个播放帧文字同步无偏差`);
  assert(visibleFrames > 0, '播放期间存在可见字幕帧');
  assert(beepTimes.length === expectedBeeps.length, '播放模拟中的提示音数量一致');

  console.log('7) 字幕边界上的严格切换语义（[start, end) 命中）');
  for (const cue of jsonCues) {
    assert(project.activeCueAt(cue.start)?.id === cue.id,
      `字幕 #${cue.id} 入点 ${cue.start}ms 立即显示`);
    assert(project.activeCueAt(cue.end)?.id !== cue.id,
      `字幕 #${cue.id} 出点 ${cue.end}ms 立即隐藏`);
  }

  console.log('\n全部一致性检查通过 ✔');
}

main();
