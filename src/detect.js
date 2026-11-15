import { intersects } from './layout.js';
import { isCjkClose } from './tokenizer.js';

function visibleTokens(line) {
  return line.tokens.filter((t) => t.type !== 'space');
}

export function detectOrphans(layout) {
  const issues = [];
  for (const para of layout.paragraphs) {
    if (para.lines.length < 2) continue;
    const last = visibleTokens(para.lines[para.lines.length - 1]);
    const substantive = last.filter((token) => !isCjkClose(token));
    const textLen = para.text.replace(/\s/g, '').length;
    if (substantive.length <= 1 && textLen > 12) {
      issues.push({
        type: 'orphan',
        severity: 'warning',
        paragraphId: para.id,
        detail: `段落「${para.id}」末行仅剩 “${last.map((t) => t.text).join('')}”，存在孤字`
      });
    }
  }
  return issues;
}

export function detectOverlaps(layout) {
  const issues = [];
  const paras = layout.paragraphs;
  for (let i = 0; i < paras.length; i += 1) {
    for (let j = i + 1; j < paras.length; j += 1) {
      if (intersects(paras[i].frame, paras[j].frame)) {
        issues.push({
          type: 'overlap',
          severity: 'error',
          paragraphId: paras[j].id,
          otherId: paras[i].id,
          detail: `段落「${paras[i].id}」与「${paras[j].id}」的框发生重叠`
        });
      }
    }
  }
  return issues;
}

export function detectOverflow(layout, params) {
  const issues = [];
  for (const para of layout.paragraphs) {
    const right = para.frame.x + para.frame.w;
    const bottom = para.frame.y + para.frame.h;
    if (right > params.frameWidth + 0.5) {
      issues.push({
        type: 'overflow-x',
        severity: 'error',
        paragraphId: para.id,
        detail: `段落「${para.id}」水平超框 ${(right - params.frameWidth).toFixed(1)}px`
      });
    }
    if (bottom > params.frameHeight + 0.5) {
      issues.push({
        type: 'overflow-y',
        severity: 'error',
        paragraphId: para.id,
        detail: `段落「${para.id}」垂直超框 ${(bottom - params.frameHeight).toFixed(1)}px`
      });
    }
  }
  return issues;
}

export function detectAll(layout, params) {
  return [
    ...detectOrphans(layout),
    ...detectOverlaps(layout),
    ...detectOverflow(layout, params)
  ];
}
