/*
 * water-core.js
 * 纯逻辑核心：参数模式、JSON 序列化/校验、质量档位策略、色相度量。
 * 同时支持浏览器 <script> 与 Node require（UMD 风格），不触碰 DOM/WebGL。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WaterCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA = 'water-panel/v1';
  const STORAGE_KEY = 'water-panel/state/v1';

  const LIMITS = {
    rippleScale: [0.2, 3.0],
    direction: [0, 360],
    fogDensity: [0, 0.1],
    reflection: [0, 1],
  };

  // 质量档只改变几何/采样细节，绝不修改任何颜色 uniform。
  const QUALITY_TIERS = {
    high: { label: '高', dprCap: 2.0, octaves: 4 },
    medium: { label: '中', dprCap: 1.25, octaves: 3 },
    low: { label: '低', dprCap: 0.75, octaves: 2 },
  };
  const TIER_ORDER = ['low', 'medium', 'high'];
  const QUALITY_MODES = ['auto', 'high', 'medium', 'low'];

  function makeDefaults() {
    return {
      schema: SCHEMA,
      rippleScale: 1.0,
      direction: 35,
      waterColor: '#1f6f8b',
      fogColor: '#c9d8e0',
      fogDensity: 0.025,
      reflection: 0.65,
      quality: 'auto',
    };
  }

  function clamp(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return min;
    return Math.min(max, Math.max(min, num));
  }

  const HEX_RE = /^#([0-9a-f]{6})$/i;

  function sanitizeHex(value, fallback) {
    if (typeof value === 'string' && HEX_RE.test(value)) {
      return value.toLowerCase();
    }
    return fallback;
  }

  function hexToRgb(hex) {
    const m = HEX_RE.exec(hex);
    if (!m) return { r: 0, g: 0, b: 0 };
    const int = parseInt(m[1], 16);
    return { r: ((int >> 16) & 255) / 255, g: ((int >> 8) & 255) / 255, b: (int & 255) / 255 };
  }

  // 丢弃未知字段、补齐缺失字段、夹紧数值范围，保证载入任何 JSON 都安全。
  function normalizeParams(input) {
    const d = makeDefaults();
    const src = input && typeof input === 'object' ? input : {};
    const out = makeDefaults();
    out.rippleScale = clamp(src.rippleScale, LIMITS.rippleScale[0], LIMITS.rippleScale[1]);
    out.direction = clamp(src.direction, LIMITS.direction[0], LIMITS.direction[1]);
    out.waterColor = sanitizeHex(src.waterColor, d.waterColor);
    out.fogColor = sanitizeHex(src.fogColor, d.fogColor);
    out.fogDensity = clamp(src.fogDensity, LIMITS.fogDensity[0], LIMITS.fogDensity[1]);
    out.reflection = clamp(src.reflection, LIMITS.reflection[0], LIMITS.reflection[1]);
    out.quality = QUALITY_MODES.indexOf(src.quality) >= 0 ? src.quality : 'auto';
    return out;
  }

  function makePresets() {
    return [
      {
        name: '晨雾湖面',
        params: {
          rippleScale: 0.7,
          direction: 20,
          waterColor: '#2b7a8f',
          fogColor: '#d7e2e6',
          fogDensity: 0.045,
          reflection: 0.5,
          quality: 'auto',
        },
      },
      {
        name: '正午碧海',
        params: {
          rippleScale: 1.4,
          direction: 110,
          waterColor: '#0f5f86',
          fogColor: '#bcd9ea',
          fogDensity: 0.012,
          reflection: 0.85,
          quality: 'auto',
        },
      },
      {
        name: '暮色深海',
        params: {
          rippleScale: 2.2,
          direction: 240,
          waterColor: '#24406b',
          fogColor: '#9fb0c8',
          fogDensity: 0.07,
          reflection: 0.3,
          quality: 'auto',
        },
      },
    ];
  }

  // 保存：只输出白名单字段 + schema 版本号。
  function toJSON(params) {
    const p = normalizeParams(params);
    return JSON.stringify(
      {
        schema: SCHEMA,
        rippleScale: p.rippleScale,
        direction: p.direction,
        waterColor: p.waterColor,
        fogColor: p.fogColor,
        fogDensity: p.fogDensity,
        reflection: p.reflection,
        quality: p.quality,
      },
      null,
      2
    );
  }

  function fromJSON(text) {
    if (typeof text !== 'string' || text.trim() === '') {
      throw new Error('空配置，无法载入');
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error('JSON 解析失败: ' + err.message);
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('配置根节点必须是对象');
    }
    if (parsed.schema !== undefined && parsed.schema !== SCHEMA) {
      throw new Error('不支持的配置版本: ' + String(parsed.schema));
    }
    return normalizeParams(parsed);
  }

  /**
   * 自适应质量策略：基于 FPS 样本，带滞回与冷却，避免在临界点反复跳档闪烁。
   * nowMs 注入时钟，便于 Node 确定性测试。
   */
  function createQualityPolicy(options) {
    const opts = options || {};
    const now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
    const lowFps = opts.lowFps || 30;
    const highFps = opts.highFps || 55;
    const cooldownMs = opts.cooldownMs != null ? opts.cooldownMs : 4000;
    const windowSize = opts.windowSize || 30;
    const initial = TIER_ORDER.indexOf(opts.initial) >= 0 ? opts.initial : 'high';

    const samples = [];
    let tier = initial;
    let lastChange = now();

    function average() {
      if (samples.length === 0) return 60;
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) sum += samples[i];
      return sum / samples.length;
    }

    return {
      sample(fps) {
        if (!Number.isFinite(fps) || fps <= 0) return tier;
        samples.push(fps);
        if (samples.length > windowSize) samples.shift();

        const t = now();
        if (t - lastChange < cooldownMs) return tier;
        const avg = average();
        const idx = TIER_ORDER.indexOf(tier);

        if (avg < lowFps && idx > 0) {
          tier = TIER_ORDER[idx - 1];
          lastChange = t;
          samples.length = 0;
        } else if (avg > highFps && idx < TIER_ORDER.length - 1) {
          // 升档更保守：需要窗口基本填满且全部样本都健康。
          if (samples.length >= windowSize) {
            tier = TIER_ORDER[idx + 1];
            lastChange = t;
            samples.length = 0;
          }
        }
        return tier;
      },
      getTier() {
        return tier;
      },
      averageFps: average,
      reset(nextTier) {
        tier = TIER_ORDER.indexOf(nextTier) >= 0 ? nextTier : initial;
        samples.length = 0;
        lastChange = now();
      },
    };
  }

  // 把当前实际质量档应用到参数之外的渲染细节（DPR、octaves），颜色不参与。
  function qualityRenderSettings(tier, devicePixelRatio) {
    const t = QUALITY_TIERS[tier] || QUALITY_TIERS.high;
    const dpr = Math.min(Math.max(0, devicePixelRatio || 1), t.dprCap);
    return { tier: tier, dpr: dpr, octaves: t.octaves, label: t.label };
  }

  // ---- 帧分析：供页面自检与 Node 测试复用 ----

  function meanRGB(pixels) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i + 2 < pixels.length; i += 4) {
      r += pixels[i];
      g += pixels[i + 1];
      b += pixels[i + 2];
      n += 1;
    }
    if (n === 0) return { r: 0, g: 0, b: 0 };
    return { r: r / n / 255, g: g / n / 255, b: b / n / 255 };
  }

  function rgbToHue(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return h;
  }

  function frameHue(pixels) {
    const c = meanRGB(pixels);
    return rgbToHue(c.r, c.g, c.b);
  }

  function hueDistance(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function compareFrames(a, b) {
    const len = Math.min(a.length, b.length);
    let maxAbs = 0, sum = 0, changed = 0;
    for (let i = 0; i < len; i += 1) {
      const d = Math.abs(a[i] - b[i]);
      if (d > maxAbs) maxAbs = d;
      if (d !== 0) changed += 1;
      sum += d;
    }
    return {
      length: len,
      maxAbsDiff: maxAbs,
      meanAbsDiff: len ? sum / len : 0,
      changedChannels: changed,
    };
  }

  return {
    SCHEMA: SCHEMA,
    STORAGE_KEY: STORAGE_KEY,
    LIMITS: LIMITS,
    QUALITY_TIERS: QUALITY_TIERS,
    TIER_ORDER: TIER_ORDER,
    QUALITY_MODES: QUALITY_MODES,
    makeDefaults: makeDefaults,
    makePresets: makePresets,
    normalizeParams: normalizeParams,
    toJSON: toJSON,
    fromJSON: fromJSON,
    hexToRgb: hexToRgb,
    createQualityPolicy: createQualityPolicy,
    qualityRenderSettings: qualityRenderSettings,
    meanRGB: meanRGB,
    rgbToHue: rgbToHue,
    frameHue: frameHue,
    hueDistance: hueDistance,
    compareFrames: compareFrames,
    clamp: clamp,
  };
});
