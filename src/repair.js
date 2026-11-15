import { layoutDocument } from './layout.js';
import { detectAll } from './detect.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function relayout(document, params, measurer) {
  return layoutDocument(document, params, measurer);
}

function findIssue(issues, type, paragraphId) {
  return issues.find((item) => item.type === type && (paragraphId == null || item.paragraphId === paragraphId));
}

function fixOverlap(document, params, measurer, issue, logs) {
  const blocker = document.paragraphs.find((p) => p.id === issue.otherId);
  const target = document.paragraphs.find((p) => p.id === issue.paragraphId);
  if (!blocker || !target) return false;
  const movable = [blocker, target].find((p) => !p.locked);
  if (!movable) {
    logs.push('两个锁定段落互相重叠，无法自动修复');
    return false;
  }
  if (params.font.lineHeight > 1.3) {
    params.font.lineHeight = Math.max(1.3, params.font.lineHeight - 0.1);
    logs.push(
      `锁定「${blocker.locked ? blocker.id : target.id}」不动，将行距下调至 ${params.font.lineHeight.toFixed(2)}，压缩未锁定段落「${movable.id}」高度`
    );
    return true;
  }
  if (params.font.sizePx > 11) {
    params.font.sizePx -= 1;
    logs.push(`行距已到下限，将字号下调至 ${params.font.sizePx}px 以消除重叠`);
    return true;
  }
  logs.push('已达到压缩下限，锁定段落导致的重叠无法完全消除');
  return false;
}

function fixOrphan(document, params, measurer, issue, logs) {
  const para = document.paragraphs.find((p) => p.id === issue.paragraphId);
  if (!para || para.locked) return false;
  para.tuning = para.tuning || {};
  para.tuning.widthFactor = Math.max(0.72, (para.tuning.widthFactor ?? 1) - 0.08);
  logs.push(`收窄「${para.id}」排版宽度至 ${(para.tuning.widthFactor * 100).toFixed(0)}%，让末行至少容纳两个字符`);
  return true;
}

function fixVerticalOverflow(document, params, measurer, issue, logs) {
  if (params.font.lineHeight > 1.35) {
    params.font.lineHeight = Math.max(1.35, params.font.lineHeight - 0.1);
    logs.push(`将行距下调至 ${params.font.lineHeight.toFixed(2)} 以消除垂直超框`);
    return true;
  }
  if (params.paraGap > 4) {
    params.paraGap = Math.max(4, params.paraGap - 2);
    logs.push(`将段间距下调至 ${params.paraGap}px`);
    return true;
  }
  if (params.font.sizePx > 11) {
    params.font.sizePx -= 1;
    logs.push(`将字号下调至 ${params.font.sizePx}px`);
    return true;
  }
  logs.push('已达到最小排版参数，仍存在垂直超框');
  return false;
}

function fixHorizontalOverflow(document, params, measurer, issue, logs) {
  const para = document.paragraphs.find((p) => p.id === issue.paragraphId);
  if (para && !para.locked) {
    para.tuning = para.tuning || {};
    para.tuning.widthFactor = Math.max(0.72, (para.tuning.widthFactor ?? 1) - 0.06);
    logs.push(`收窄「${para.id}」排版宽度至 ${(para.tuning.widthFactor * 100).toFixed(0)}% 以消除水平超框`);
    return true;
  }
  return false;
}

export function autoRepair(document, inputParams, measurer, maxRounds = 30) {
  const params = clone(inputParams);
  const documentCopy = clone(document);
  const logs = [];
  let layout = relayout(documentCopy, params, measurer);
  let issues = detectAll(layout, params);
  const before = issues.map((item) => item.detail);

  for (let round = 1; round <= maxRounds && issues.length > 0; round += 1) {
    const priority = ['overlap', 'overflow-y', 'overflow-x', 'orphan'];
    const issue = priority
      .map((type) => issues.find((item) => item.type === type))
      .find(Boolean);
    let changed = false;
    if (issue.type === 'overlap') {
      changed = fixOverlap(documentCopy, params, measurer, issue, logs);
    } else if (issue.type === 'orphan') {
      changed = fixOrphan(documentCopy, params, measurer, issue, logs);
    } else if (issue.type === 'overflow-y') {
      changed = fixVerticalOverflow(documentCopy, params, measurer, issue, logs);
    } else if (issue.type === 'overflow-x') {
      changed = fixHorizontalOverflow(documentCopy, params, measurer, issue, logs);
    }
    layout = relayout(documentCopy, params, measurer);
    issues = detectAll(layout, params);
    if (!changed) break;
  }

  return {
    layout,
    params,
    document: documentCopy,
    logs,
    issuesBefore: before,
    issuesAfter: issues
  };
}
