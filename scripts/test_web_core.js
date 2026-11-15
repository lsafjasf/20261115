// 用最小浏览器桩加载 web/ 下的 UMD 模块，验证其与 Node 引擎行为/输出一致。
const fs = require('fs');
const path = require('path');
const nodeStudio = require('../subtitle_studio');

const sandbox = {};
global.window = sandbox;
for (const file of ['studio_core.js', 'studio_audio.js', 'studio_export.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'web', file), 'utf8');
  new Function(code).call(sandbox);
}
const webCore = sandbox.StudioCore;

function assert(condition, message) {
  if (!condition) throw new Error(`浏览器引擎测试失败: ${message}`);
  console.log(`  [通过] ${message}`);
}

const webProject = new webCore.Project(20000);
const nodeProject = new nodeStudio.Project(20000);
const cues = [
  [500, 2900, '清晨的光线慢慢爬上窗台。'],
  [3200, 5600, '风穿过树林，送来溪水的声音。'],
  [6000, 11600, '合并后的长句。 另一句。'],
  [12000, 14800, '云在天上慢慢走。'],
  [15200, 16900, '断句前半。'],
  [16900, 18600, '断句后半。'],
];
for (const [start, end, text] of cues) {
  webProject.addCue(start, end, text);
  nodeProject.addCue(start, end, text);
}

assert(webCore.exportWebVtt(webProject) === nodeStudio.exportWebVtt(nodeProject),
  'WebVTT 输出与 Node 端逐字符一致');
assert(webCore.exportProjectJSON(webProject) === nodeStudio.exportProjectJSON(nodeProject),
  '工程 JSON 输出与 Node 端逐字符一致');

const webWav = webCore.synthesizeWav(webProject.durationMs, webProject.sortedCues());
const nodeWav = nodeStudio.synthesizeWav(nodeProject.durationMs, nodeProject.sortedCues());
assert(webWav.length === nodeWav.length, `WAV 长度一致（${webWav.length} 字节）`);
let mismatch = 0;
for (let i = 0; i < webWav.length; i += 1) if (webWav[i] !== nodeWav[i]) mismatch += 1;
assert(mismatch === 0, 'WAV 逐字节一致（同一套合成算法）');

let blocked = 0;
for (const attempt of [
  () => webProject.updateCue(2, { start: 1000 }),
  () => webProject.updateCue(1, { start: 2900, end: 2900 }),
  () => webProject.updateCue(6, { end: 20500 }),
]) {
  try {
    attempt();
  } catch (error) {
    if (error instanceof webCore.ValidationError) blocked += 1;
  }
}
assert(blocked === 3, '重叠/零长度/超范围三类编辑在浏览器引擎中同样被阻止');
assert(webProject.cues.length === 6, '被阻止的编辑未污染工程，仍是六条字幕');

const reloaded = webCore.Project.fromJSON(JSON.parse(webCore.exportProjectJSON(webProject)));
assert(reloaded.cues.length === 6 && reloaded.durationMs === 20000,
  '浏览器端工程 JSON 可完整往返重载');
assert(webCore.parseWebVtt(webCore.exportWebVtt(webProject)).length === 6,
  '浏览器端 VTT 解析回 6 条字幕');

console.log('\n浏览器引擎对等性测试全部通过 ✔');
