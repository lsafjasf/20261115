// 重新载入导出产物：解析 WebVTT / WAV / 工程 JSON，供一致性检查。
const { Project, ValidationError } = require('./project');

function parseVttTimestamp(token) {
  const match = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(token.trim());
  if (!match) throw new Error(`无法解析 VTT 时间戳: ${token}`);
  const [, hours, minutes, seconds, millis] = match;
  return (
    Number(hours) * 3600000 +
    Number(minutes) * 60000 +
    Number(seconds) * 1000 +
    Number(millis)
  );
}

function parseWebVtt(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines[0].trim() !== 'WEBVTT') {
    throw new Error('缺少 WEBVTT 文件头');
  }
  const cues = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.includes('-->')) continue;
    const [startToken, endToken] = line.split('-->').map((part) => part.trim());
    const start = parseVttTimestamp(startToken);
    const end = parseVttTimestamp(endToken);
    const textLines = [];
    i += 1;
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i += 1;
    }
    cues.push({ start, end, text: textLines.join('\n') });
  }
  return cues;
}

function parseWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readString = (offset, length) => {
    let text = '';
    for (let i = 0; i < length; i += 1) text += String.fromCharCode(view.getUint8(offset + i));
    return text;
  };
  if (readString(0, 4) !== 'RIFF' || readString(8, 4) !== 'WAVE') {
    throw new Error('不是合法 WAV 文件');
  }
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= bytes.length) {
    const chunkId = readString(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (!fmt || dataOffset < 0) throw new Error('WAV 缺少 fmt/data 块');
  const sampleCount = Math.floor(dataSize / (fmt.bitsPerSample / 8) / fmt.channels);
  const samples = new Int16Array(sampleCount);
  const frameSize = (fmt.bitsPerSample / 8) * fmt.channels;
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = view.getInt16(dataOffset + i * frameSize, true);
  }
  return { fmt, samples, durationMs: Math.round((sampleCount / fmt.sampleRate) * 1000) };
}

function parseProjectJSON(content) {
  return Project.fromJSON(JSON.parse(content));
}

module.exports = { parseWebVtt, parseWav, parseProjectJSON, ValidationError };
