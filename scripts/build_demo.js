// 端到端演示：合成语音时间点 -> 六条可编辑字幕 -> 编辑/拦截 -> 三种导出。
const fs = require('fs');
const path = require('path');
const {
  Project,
  ValidationError,
  exportWebVtt,
  exportProjectJSON,
  synthesizeWav,
} = require('../subtitle_studio');

const OUT_DIR = path.join(__dirname, '..', 'output');
const DURATION_MS = 20000;

// 模拟一段合成语音的六个分句时间点（单位毫秒）。
const SPEECH_CUES = [
  [600, 2800, '清晨的光线慢慢爬上窗台。'],
  [3200, 5600, '风穿过树林，带来远处溪水的声音。'],
  [6000, 8600, '我们把脚步放轻，生怕惊动了鸟儿。'],
  [9000, 11600, '山路上的每一块石头，都记得行人的温度。'],
  [12000, 14800, '云在天上慢慢走，影子滑过整片田野。'],
  [15200, 18600, '当夜幕落下，星光会替我们记住今天。'],
];

function expectRejected(label, fn) {
  try {
    fn();
    throw new Error(`${label} 应当被拦截却成功了`);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    console.log(`  [拦截] ${label} -> ${error.code}: ${error.message}`);
    return error.code;
  }
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const project = new Project(DURATION_MS);

  console.log('1) 从合成语音时间点建立六条字幕');
  for (const [start, end, text] of SPEECH_CUES) project.addCue(start, end, text);
  console.log(`   当前字幕数: ${project.cues.length}`);

  console.log('2) 用户调整入点/出点与文本');
  project.updateCue(1, { start: 500, end: 2900 });
  project.updateCue(2, { text: '风穿过树林，送来溪水的声音。' });

  console.log('3) 先合并相邻的第三、四条，再把第六条断句，最终保持六条字幕');
  const merged = project.mergeCues(3, 4);
  console.log(`   合并后: "${merged.text}"，字幕数=${project.cues.length}`);
  const split = project.splitCue(6, 16900);
  console.log(`   断句后: "${split.left.text}" | "${split.right.text}"，字幕数=${project.cues.length}`);

  console.log('4) 非法编辑必须全部阻止');
  const cue2 = project.getCue(2);
  expectRejected('重叠（第二条入点侵入第一条）', () =>
    project.updateCue(2, { start: 1000 }));
  expectRejected('零长度（出点=入点）', () =>
    project.updateCue(1, { start: 2900, end: 2900 }));
  expectRejected('超出视频范围（出点越过片尾）', () =>
    project.updateCue(6, { end: DURATION_MS + 500 }));
  expectRejected('越界断句点', () => project.splitCue(1, 200));
  // 确认被拦截的数据没有污染工程。
  if (project.getCue(2).start !== cue2.start) throw new Error('拦截后工程被污染');

  if (project.cues.length !== 6) {
    throw new Error(`最终字幕数应为 6，实际 ${project.cues.length}`);
  }

  console.log('5) 重新合成节奏提示音并导出三种文件');
  const vtt = exportWebVtt(project);
  const json = exportProjectJSON(project);
  const wav = synthesizeWav(project.durationMs, project.sortedCues());
  fs.writeFileSync(path.join(OUT_DIR, 'subtitles.vtt'), vtt, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'project.json'), json, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'rhythm.wav'), wav);

  console.log('导出完成:');
  for (const cue of project.sortedCues()) {
    console.log(`   #${cue.id} ${cue.start}->${cue.end} ${cue.text}`);
  }
}

main();
