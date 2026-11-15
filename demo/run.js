import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HeadlessMeasurer } from '../src/measurer.js';
import { layoutDocument, LANGUAGE_PRESETS } from '../src/layout.js';
import { detectAll } from '../src/detect.js';
import { autoRepair } from '../src/repair.js';
import { exportSVG } from '../src/svg.js';
import { document, initialParams } from './document.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'artifacts');
const measurer = new HeadlessMeasurer();

function report(title, issues) {
  console.log(`\n== ${title} ==`);
  if (issues.length === 0) {
    console.log('未检测到孤字、重叠或超框');
    return;
  }
  for (const issue of issues) console.log(`[${issue.severity}] ${issue.type}: ${issue.detail}`);
}

await mkdir(outDir, { recursive: true });

const before = layoutDocument(document, initialParams, measurer);
const issuesBefore = detectAll(before, initialParams);
report('修复前检测', issuesBefore);

const result = autoRepair(document, initialParams, measurer);
report('修复后检测', result.issuesAfter);

console.log('\n== 自动修复动作 ==');
result.logs.forEach((item, index) => console.log(`${index + 1}. ${item}`));

const preset = LANGUAGE_PRESETS.cjk;
console.log(`\n== 切换语言模式：${preset.label} ==`);
const switchedParams = {
  ...result.params,
  breakMode: preset.breakMode,
  justify: preset.justify,
  font: { ...result.params.font, ...preset.font }
};
const switched = layoutDocument(result.document, switchedParams, measurer);
const switchedIssues = detectAll(switched, switchedParams);
console.log(
  `内容段落数保持 ${switched.paragraphs.length}，文本未重置；新参数 breakMode=${switchedParams.breakMode}, lineHeight=${switchedParams.font.lineHeight}, tracking=${switchedParams.font.cjkTracking}`
);
const switchedResult = autoRepair(result.document, switchedParams, measurer);
console.log('切换后自动复查并修复：');
if (switchedResult.logs.length === 0) console.log('无需额外修复');
switchedResult.logs.forEach((item, index) => console.log(`${index + 1}. ${item}`));
report('切换模式后检测', switchedResult.issuesAfter);

const svgBefore = exportSVG(before);
const svgAfter = exportSVG(result.layout);
const switchedLayout = switchedResult.layout;
const finalSwitchedParams = switchedResult.params;
const svgSwitched = exportSVG(switchedLayout);
await writeFile(join(outDir, 'before.svg'), svgBefore);
await writeFile(join(outDir, 'after-repair.svg'), svgAfter);
await writeFile(join(outDir, 'after-cjk-mode.svg'), svgSwitched);
await writeFile(
  join(outDir, 'report.json'),
  JSON.stringify(
    {
      issuesBefore: result.issuesBefore,
      issuesAfter: result.issuesAfter,
      repairLogs: result.logs,
      switchedMode: {
        name: 'cjk',
        label: preset.label,
        params: finalSwitchedParams,
        issues: switchedResult.issuesAfter,
        repairLogs: switchedResult.logs
      }
    },
    null,
    2
  )
);

const textNodeCount = (svgAfter.match(/<text /g) || []).length;
console.log(`\n已导出 artifacts/before.svg、artifacts/after-repair.svg、artifacts/after-cjk-mode.svg`);
console.log(`after-repair.svg 保留 ${textNodeCount} 个 <text> 节点（未转曲）`);
