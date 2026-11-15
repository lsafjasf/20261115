// 无头“预览器”：模拟播放头逐帧推进，验证画面文字与提示音严格同步。
const { renderPcmFloat, SAMPLE_RATE } = require('./audio');

function detectBeepTimes(durationMs, cues, threshold = 0.08) {
  const { buffer } = renderPcmFloat(durationMs, cues);
  const events = [];
  let active = false;
  let onsetSample = 0;
  const windowSize = Math.round(SAMPLE_RATE * 0.01);
  for (let start = 0; start < buffer.length; start += windowSize) {
    let peak = 0;
    const end = Math.min(buffer.length, start + windowSize);
    for (let i = start; i < end; i += 1) peak = Math.max(peak, Math.abs(buffer[i]));
    if (peak >= threshold && !active) {
      active = true;
      onsetSample = start;
    } else if (peak < threshold / 2 && active) {
      active = false;
      events.push(Math.round((onsetSample / SAMPLE_RATE) * 1000));
    }
  }
  if (active) events.push(Math.round((onsetSample / SAMPLE_RATE) * 1000));
  return events;
}

// 返回每个采样时刻的播放头状态：文字命中 + 该时刻是否处于提示音区间。
function simulatePlayback(project, frameStepMs = 40) {
  const cues = project.sortedCues();
  const expectedBeeps = new Set();
  for (const cue of cues) {
    expectedBeeps.add(cue.start);
    expectedBeeps.add(cue.end);
  }
  const beepTimes = detectBeepTimes(project.durationMs, cues);
  const frames = [];
  for (let t = 0; t < project.durationMs; t += frameStepMs) {
    frames.push({ timeMs: t, activeText: project.activeCueAt(t)?.text || null });
  }
  return { frames, beepTimes, expectedBeeps: [...expectedBeeps].sort((a, b) => a - b) };
}

module.exports = { detectBeepTimes, simulatePlayback };
