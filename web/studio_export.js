// 浏览器版导出/导入：WebVTT、工程 JSON、WAV 下载，以及工程重载。
(function (global) {
  const core = global.StudioCore;

  function pad2(value) { return String(value).padStart(2, '0'); }
  function pad3(value) { return String(value).padStart(3, '0'); }

  function vttTimestamp(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${pad3(ms % 1000)}`;
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

  function downloadBytes(filename, bytes, mime) {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadText(filename, text, mime) {
    downloadBytes(filename, new TextEncoder().encode(text), mime);
  }

  function parseVttTimestamp(token) {
    const match = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(token.trim());
    if (!match) throw new Error(`无法解析 VTT 时间戳: ${token}`);
    return Number(match[1]) * 3600000 + Number(match[2]) * 60000
      + Number(match[3]) * 1000 + Number(match[4]);
  }

  function parseWebVtt(content) {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    if (lines[0].trim() !== 'WEBVTT') throw new Error('缺少 WEBVTT 文件头');
    const cues = [];
    for (let i = 1; i < lines.length; i += 1) {
      if (!lines[i].includes('-->')) continue;
      const [startToken, endToken] = lines[i].split('-->').map((part) => part.trim());
      const textLines = [];
      i += 1;
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i]);
        i += 1;
      }
      cues.push({ start: parseVttTimestamp(startToken),
        end: parseVttTimestamp(endToken), text: textLines.join('\n') });
    }
    return cues;
  }

  Object.assign(core, {
    vttTimestamp, exportWebVtt, exportProjectJSON,
    downloadBytes, downloadText, parseWebVtt,
  });
})(typeof window !== 'undefined' ? window : globalThis);
