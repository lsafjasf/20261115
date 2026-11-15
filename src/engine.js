/*
 * 排版引擎：缺字时生成“伪字形”（几何骨架，仍参与字腔测量），
 * 用测量结果决定每个字形的实际粗细与前进宽度，再按 tracking/行高断行布局。
 */
(function (root) {
  'use strict';

  const PSEUDO_TEMPLATES = [
    (G) => [G.rectStroke(220, 200, 560, 620, 92)],
    (G) => [G.line(180, 240, 820, 240, 86), G.line(500, 240, 500, 820, 100),
      G.line(180, 820, 820, 820, 86)],
    (G) => [G.line(180, 260, 820, 260, 86), G.line(180, 500, 820, 500, 86),
      G.line(180, 740, 820, 740, 86)],
    (G) => [G.ellipseStroke(500, 510, 260, 320, 92)],
  ];

  function pseudoGlyph(ch) {
    let hash = 0;
    for (let i = 0; i < ch.length; i++) hash = (hash * 31 + ch.charCodeAt(i)) >>> 0;
    const isCjk = /[\u3400-\u9fff\uf900-\ufaff]/.test(ch);
    const advance = isCjk ? 1000 : 560;
    const strokes = PSEUDO_TEMPLATES[hash % PSEUDO_TEMPLATES.length](root.Geo);
    return { id: 'pseudo:' + ch, advance, strokes, cjk: isCjk, pseudo: true };
  }

  function createEngine(measurer) {
    function resolveGlyph(ch) {
      const g = root.GlyphLib[ch] || pseudoGlyph(ch);
      return g;
    }

    function layout(text, opts) {
      const {
        weight = 1, roundness = 0.2, tracking = 40,
        lineHeight = 1.35, adapt = true, maxWidth = 0,
      } = opts || {};
      const chars = Array.from(text.replace(/\r/g, ''));
      const lines = [[]];
      let cursor = 0;

      for (const ch of chars) {
        if (ch === '\n') {
          lines.push([]);
          cursor = 0;
          continue;
        }
        const glyph = resolveGlyph(ch);
        if (glyph.space) {
          const item = { ch, glyph, scale: 1, advance: glyph.advance, space: true, x: cursor };
          lines[lines.length - 1].push(item);
          cursor += glyph.advance + tracking;
          continue;
        }
        const target = weight;
        const result = glyph.strokes.length
          ? measurer.resolve(glyph, target)
          : { scale: target, clamped: false, metrics: null, base: null };
        const scale = adapt ? result.scale : target;
        const widthPad = Math.max(...glyph.strokes.map((s) => s.w)) * scale;
        const advance = glyph.advance + widthPad * 0.35;
        const item = {
          ch, glyph, scale, advance,
          clamped: !!result.clamped,
          metrics: result.metrics, base: result.base,
          x: cursor,
        };
        lines[lines.length - 1].push(item);
        cursor += advance + tracking;
      }

      const rawLines = lines.map((items) => {
        const width = items.reduce((sum, it) => sum + it.advance + tracking, -tracking);
        return { items, width: Math.max(width, 0) };
      });

      let finalLines = rawLines;
      if (maxWidth > 0) {
        finalLines = [];
        for (const line of rawLines) {
          let cur = [], w = 0;
          for (const it of line.items) {
            const add = it.advance + tracking;
            if (cur.length && w + add > maxWidth) {
              finalLines.push({ items: cur, width: w - tracking });
              cur = []; w = 0;
            }
            cur.push(it); w += add;
          }
          finalLines.push({ items: cur, width: Math.max(w - tracking, 0) });
        }
      }

      const lineGap = lineHeight * 1000;
      const positioned = [];
      finalLines.forEach((line, li) => {
        let x = 0;
        for (const it of line.items) {
          positioned.push(Object.assign({}, it, { x, y: li * lineGap }));
          x += it.advance + tracking;
        }
      });
      const contentWidth = Math.max(0, ...finalLines.map((ln) => ln.width));
      const contentHeight = Math.max(finalLines.length, 1) * lineGap;
      return { lines: finalLines, items: positioned, contentWidth, contentHeight, lineGap };
    }

    return { layout, pseudoGlyph };
  }

  const api = { createEngine, pseudoGlyph };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
