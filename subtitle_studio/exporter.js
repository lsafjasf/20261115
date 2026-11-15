// 导出 WebVTT 与工程 JSON；WAV 由 audio.js 负责。

function pad2(value) {
  return String(value).padStart(2, '0');
}

function pad3(value) {
  return String(value).padStart(3, '0');
}

// WebVTT 时间戳格式：HH:MM:SS.mmm
function vttTimestamp(ms) {
  if (!Number.isInteger(ms) || ms < 0) {
    throw new Error(`非法时间戳: ${ms}`);
  }
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
}

function exportWebVtt(project) {
  const lines = ['WEBVTT', ''];
  for (const cue of project.sortedCues()) {
    lines.push(`${vttTimestamp(cue.start)} --> ${vttTimestamp(cue.end)}`);
    lines.push(cue.text);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function exportProjectJSON(project) {
  return `${JSON.stringify(project.toJSON(), null, 2)}\n`;
}

module.exports = { vttTimestamp, exportWebVtt, exportProjectJSON };
