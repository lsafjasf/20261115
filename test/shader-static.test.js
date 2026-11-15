'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/water-renderer.js');

test('渲染器模块可在非浏览器环境加载并暴露着色器', () => {
  assert.equal(typeof R.createRenderer, 'function');
  assert.ok(R.VERT.includes('attribute vec2 aPos'));
  assert.ok(R.FRAG.includes('precision highp float'));
});

test('GLSL 源码不包含兼容性差的 break / discard 写法', () => {
  assert.equal(/\bbreak\s*;/.test(R.FRAG), false);
  assert.equal(/\bdiscard\b/.test(R.FRAG), false);
});

test('所有 uniform 均在片元着色器中声明', () => {
  const uniforms = [
    'uResolution', 'uTime', 'uRippleScale', 'uDirRad', 'uWaterColor',
    'uFogColor', 'uFogDensity', 'uReflection', 'uOctaves',
  ];
  for (const name of uniforms) {
    assert.ok(R.FRAG.includes(name), '缺少 uniform: ' + name);
  }
});

test('颜色相关 uniform 只有水色与雾色，质量档无法影响颜色输入', () => {
  assert.ok(R.FRAG.includes('uniform vec3 uWaterColor'));
  assert.ok(R.FRAG.includes('uniform vec3 uFogColor'));
  assert.equal(/uOctaves.*Color|Color.*uOctaves/.test(R.FRAG), false);
});
