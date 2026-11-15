'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function makeDom() {
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy({}, { get: (t, prop) => {
      if (prop === 'canvas') return this;
      return typeof prop === 'string' ? () => {} : undefined;
    }, set: () => true });
  };
  ['solver.js', 'scenarios.js', 'keyframe-store.js', 'renderer.js', 'app.js'].forEach((f) => {
    window.eval(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'));
  });
  return dom;
}

test('页面初始加载即可解并渲染状态', () => {
  const dom = makeDom();
  const doc = dom.window.document;
  assert.ok(doc.getElementById('status').className.includes('ok'));
  assert.ok(doc.getElementById('status').textContent.includes('可行'));
  assert.equal(doc.getElementById('conflict').hidden, true);
});

test('切换无解场景后显示冲突来源，放宽布景后恢复可行', () => {
  const dom = makeDom();
  const doc = dom.window.document;
  doc.querySelector('button[data-scene="infeasible"]').click();
  assert.ok(doc.getElementById('status').className.includes('bad'));
  assert.equal(doc.getElementById('conflict').hidden, false);
  assert.ok(doc.getElementById('conflict').textContent.includes('中央高墙'));

  const relaxSet = doc.getElementById('relaxSet');
  relaxSet.checked = true;
  relaxSet.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.ok(doc.getElementById('status').className.includes('ok'));
  assert.equal(doc.getElementById('conflict').hidden, true);
});

test('保存关键帧后刷新式重建状态可恢复并重新求解', () => {
  const dom = makeDom();
  const win = dom.window;
  const doc = win.document;
  win.prompt = () => '我的镜头';
  doc.getElementById('saveFrame').click();
  const stored = JSON.parse(win.localStorage.getItem('camera-keyframes-v1'));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].note, '我的镜头');
  assert.equal(stored[0].result.feasible, true);

  doc.querySelector('button[data-scene="infeasible"]').click();
  assert.ok(doc.getElementById('status').className.includes('bad'));
  doc.querySelector('#frameList li button').click();
  assert.ok(doc.getElementById('status').className.includes('ok'));
  assert.ok(doc.getElementById('frameList').textContent.includes('我的镜头'));
  assert.equal(doc.getElementById('focalValue').textContent, String(stored[0].focal));
});

test('焦段滑杆实时重新求解，过长焦段报无解', () => {
  const dom = makeDom();
  const doc = dom.window.document;
  const focal = doc.getElementById('focal');
  focal.value = '200';
  focal.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.ok(doc.getElementById('status').className.includes('bad'));
  assert.ok(doc.getElementById('conflict').textContent.includes('视野过窄'));
});

test('导出按钮生成 JSON 下载并可清空关键帧', () => {
  const dom = makeDom();
  const win = dom.window;
  const doc = win.document;
  let downloaded = null;
  win.prompt = () => '导出帧';
  win.Blob = class Blob {
    constructor(parts) { this.text = parts.join(''); }
  };
  win.URL.createObjectURL = () => 'blob:mock';
  win.URL.revokeObjectURL = () => {};
  doc.getElementById('saveFrame').click();
  const anchor = doc.createElement('a');
  const origClick = anchor.click.bind(anchor);
  win.HTMLAnchorElement.prototype.click = function () {
    downloaded = this.download;
    origClick();
  };
  doc.getElementById('exportFrames').click();
  assert.equal(downloaded, 'camera-keyframes.json');

  doc.getElementById('clearFrames').click();
  assert.equal(doc.querySelectorAll('#frameList li').length, 0);
  assert.equal(win.localStorage.getItem('camera-keyframes-v1'), '[]');
});
