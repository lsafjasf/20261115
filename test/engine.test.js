import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, breakAllowed } from '../src/tokenizer.js';
import { HeadlessMeasurer } from '../src/measurer.js';
import { layoutDocument } from '../src/layout.js';
import { detectAll, detectOrphans } from '../src/detect.js';
import { autoRepair } from '../src/repair.js';
import { exportSVG } from '../src/svg.js';

const measurer = new HeadlessMeasurer();

const params = {
  frameWidth: 320,
  frameHeight: 500,
  padding: 20,
  paraGap: 10,
  breakMode: 'strict',
  justify: true,
  hangingPunct: false,
  font: {
    family: 'sans-serif',
    sizePx: 16,
    lineHeight: 1.6,
    cjkTracking: 0
  }
};

test('tokenizer separates han, latin words, numbers, punctuation and spaces', () => {
  const types = tokenize('中文 ABC 1,024.5。').map((t) => t.type);
  assert.deepEqual(types, ['han', 'han', 'space', 'latin', 'space', 'number', 'punct']);
});

test('strict kinsoku forbids line starting with closing punctuation', () => {
  const tokens = tokenize('字。');
  assert.equal(breakAllowed(tokens[0], tokens[1], true), false);
  assert.equal(breakAllowed(tokens[0], tokens[1], false), true);
});

test('layout keeps every token inside content width', () => {
  const doc = {
    paragraphs: [
      { id: 'a', text: '中文混排 English 与数字 36 在同一行测量并校对。'.repeat(4) }
    ]
  };
  const layout = layoutDocument(doc, params, measurer);
  const contentWidth = params.frameWidth - params.padding * 2;
  for (const para of layout.paragraphs) {
    for (const line of para.lines) {
      const maxRight = Math.max(...line.items.map((item) => item.x + item.width));
      assert.ok(maxRight <= contentWidth + 0.01);
    }
  }
});

test('detector finds orphan and repair removes it without changing text', () => {
  const doc = {
    paragraphs: [
      {
        id: 'orphan',
        tuning: { widthFactor: 1.4 },
        text: `中文 English 123。${'甲'.repeat(17)}。`
      }
    ]
  };
  const before = layoutDocument(doc, params, measurer);
  assert.ok(detectOrphans(before).length >= 1);
  const result = autoRepair(doc, params, measurer);
  assert.equal(detectAll(result.layout, result.params).length, 0);
  assert.equal(result.document.paragraphs[0].text, doc.paragraphs[0].text);
});

test('locked paragraph frame stays fixed while others reflow', () => {
  const doc = {
    paragraphs: [
      { id: 'a', text: '第一段未锁定内容。'.repeat(8) },
      { id: 'locked', locked: true, frame: { x: 0, y: 150, w: 320, h: 80 }, text: '锁定段落 2026。' },
      { id: 'b', text: '第二段未锁定内容 English 123。'.repeat(4) }
    ]
  };
  const result = autoRepair(doc, params, measurer);
  const locked = result.layout.paragraphs.find((p) => p.id === 'locked');
  assert.deepEqual(locked.frame, { x: 0, y: 150, w: 320, h: 80 });
  const following = result.layout.paragraphs.find((p) => p.id === 'b');
  assert.ok(following.frame.y >= locked.frame.y + locked.frame.h);
});

test('SVG export preserves text and emits no vector paths', () => {
  const doc = { paragraphs: [{ id: 'a', text: '中文 English 123。' }] };
  const layout = layoutDocument(doc, params, measurer);
  const svg = exportSVG(layout);
  assert.match(svg, /<text /);
  assert.doesNotMatch(svg, /<path/);
  assert.ok(svg.includes('English'));
});
