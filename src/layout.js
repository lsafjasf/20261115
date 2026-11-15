import { tokenize, breakAllowed } from './tokenizer.js';

export const DEFAULT_PARAMS = {
  frameWidth: 520,
  frameHeight: 560,
  padding: 24,
  paraGap: 12,
  breakMode: 'greedy',
  justify: true,
  hangingPunct: true,
  font: {
    family: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif',
    sizePx: 16,
    lineHeight: 1.8,
    cjkTracking: 0
  }
};

export const LANGUAGE_PRESETS = {
  cjk: {
    label: '中文优先',
    font: { cjkTracking: 0.5, lineHeight: 1.9 },
    breakMode: 'strict',
    justify: true
  },
  latin: {
    label: 'English-first',
    font: { cjkTracking: 0, lineHeight: 1.6 },
    breakMode: 'greedy',
    justify: false
  },
  numeric: {
    label: '数字密集',
    font: { cjkTracking: 0.2, lineHeight: 1.75 },
    breakMode: 'greedy',
    justify: true
  }
};

function intersects(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function buildLines(tokens, measurer, font, params, contentWidth) {
  const breakMode = params.breakMode || 'greedy';
  const strict = breakMode === 'strict';
  const lines = [];
  let line = [];
  let lineWidth = 0;

  const pushLine = () => {
    lines.push({ tokens: line, width: Math.max(0, lineWidth) });
    line = [];
    lineWidth = 0;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const tokenWidth = measurer.width(token, font);
    if (line.length === 0) {
      line.push(token);
      lineWidth = tokenWidth;
      continue;
    }
    const prev = line[line.length - 1];
    const canBreak = breakAllowed(prev, token, strict);
    if (canBreak && lineWidth + tokenWidth > contentWidth) {
      if (params.hangingPunct && strict && token.cjk && token.type === 'punct') {
        line.push(token);
        lineWidth += tokenWidth;
        pushLine();
      } else {
        pushLine();
        line.push(token);
        lineWidth = tokenWidth;
      }
    } else {
      line.push(token);
      lineWidth += tokenWidth;
    }
  }
  if (line.length > 0) pushLine();

  const spaceW = measurer.spaceWidth(font);
  for (const item of lines) {
    const spaces = item.tokens.filter((t) => t.type === 'space').length;
    item.extra = 0;
    if (params.justify && spaces > 0 && item !== lines[lines.length - 1]) {
      item.extra = Math.max(0, (contentWidth - item.width) / spaces);
    }
    item.spaceWidth = spaceW;
  }
  return lines;
}

function positionTokens(lines, measurer, font, params) {
  const lineHeight = font.sizePx * font.lineHeight;
  const padding = params.padding;
  let y = 0;
  for (const line of lines) {
    let x = 0;
    line.lineHeight = lineHeight;
    line.top = y;
    line.items = [];
    for (const token of line.tokens) {
      const width = measurer.width(token, font);
      line.items.push({ token, x, y: y + lineHeight * 0.78, width });
      x += width + (token.type === 'space' ? line.extra : 0);
    }
    line.bottom = y + lineHeight;
    y += lineHeight;
  }
  return y;
}

export function layoutParagraph(paragraph, params, measurer) {
  const widthFactor = paragraph.tuning?.widthFactor ?? 1;
  const paraWidth = params.frameWidth * widthFactor;
  const contentWidth = paraWidth - params.padding * 2;
  const tokens = tokenize(paragraph.text);
  const lines = buildLines(tokens, measurer, params.font, params, contentWidth);
  const textHeight = positionTokens(lines, measurer, params.font, params);
  const height = textHeight + params.padding * 2;
  return {
    id: paragraph.id,
    text: paragraph.text,
    locked: Boolean(paragraph.locked),
    frame: paragraph.frame || { x: 0, y: 0, w: paraWidth, h: height },
    lines,
    height
  };
}

export function layoutDocument(document, params, measurer) {
  const paragraphs = document.paragraphs.map((p) => {
    const laid = layoutParagraph(p, params, measurer);
    if (p.locked && p.frame) {
      laid.frame = { ...p.frame };
      laid.height = p.frame.h;
    }
    return laid;
  });

  let flowY = 0;
  for (const para of paragraphs) {
    if (para.locked) {
      if (!para.frame || para.frame.y == null) {
        para.frame = { x: 0, y: flowY, w: params.frameWidth, h: para.height };
        flowY = para.frame.y + para.frame.h + params.paraGap;
      } else {
        flowY = Math.max(flowY, para.frame.y + para.frame.h + params.paraGap);
      }
      continue;
    }
    para.frame = { x: 0, y: flowY, w: params.frameWidth, h: para.height };
    flowY += para.height + params.paraGap;
  }

  const usedHeight = paragraphs.reduce((max, p) => Math.max(max, p.frame.y + p.frame.h), 0);
  return {
    paragraphs,
    size: { width: params.frameWidth, height: Math.max(params.frameHeight, usedHeight) },
    params
  };
}

export { intersects };
