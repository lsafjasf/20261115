// Core logic for the spectrogram comparison tool.
// Pure functions only: no DOM access, so this file is also runnable under Node
// for testing. The browser page (index.html) and test_core.js both use it.
(function (global) {
  'use strict';

  // Viridis approximation via piecewise-linear stops of the matplotlib table.
  const VIRIDIS_STOPS = [
    [68, 1, 84], [72, 35, 116], [64, 67, 135], [52, 94, 141],
    [41, 120, 142], [32, 144, 140], [34, 167, 132], [68, 190, 112],
    [121, 209, 81], [186, 222, 40], [253, 231, 37],
  ];

  // Jet (classic rainbow) colormap.
  function jetColor(t) {
    const r = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 3)));
    const g = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 2)));
    const b = Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 1)));
    return [r * 255, g * 255, b * 255];
  }

  function stopsColor(stops) {
    return function (t) {
      const n = stops.length - 1;
      const x = Math.min(0.9999999, Math.max(0, t)) * n;
      const i = Math.floor(x);
      const f = x - i;
      const a = stops[i];
      const b = stops[i + 1];
      return [
        a[0] + (b[0] - a[0]) * f,
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f,
      ];
    };
  }

  const COLORMAPS = {
    viridis: stopsColor(VIRIDIS_STOPS),
    jet: jetColor,
  };

  // Unified color scale: ONE normalization shared by every subplot, so the
  // stitched image can never show mismatched iso-color blocks at a divider.
  function makeColorScale(vmin, vmax, cmapName) {
    const cmap = COLORMAPS[cmapName];
    if (!cmap) throw new Error('unknown colormap: ' + cmapName);
    if (!(vmax > vmin)) throw new Error('vmax must be greater than vmin');
    const span = vmax - vmin;
    return function valueToRGB(value) {
      let t = (value - vmin) / span;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      return cmap(t);
    };
  }

  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // Bilinear-interpolated value noise, summed over octaves.
  function valueNoise(width, height, seed) {
    const rng = makeRng(seed);
    const out = new Float32Array(width * height);
    let amplitude = 1;
    let totalAmp = 0;
    for (let octave = 0; octave < 4; octave++) {
      const gw = 3 << octave;
      const gh = 3 << octave;
      const grid = new Float32Array((gw + 1) * (gh + 1));
      for (let i = 0; i < grid.length; i++) grid[i] = rng();
      for (let y = 0; y < height; y++) {
        const gy = Math.min(gh - 1e-6, (y / (height - 1)) * gh);
        const y0 = Math.floor(gy);
        const fy = gy - y0;
        for (let x = 0; x < width; x++) {
          const gx = Math.min(gw - 1e-6, (x / (width - 1)) * gw);
          const x0 = Math.floor(gx);
          const fx = gx - x0;
          const i00 = grid[y0 * (gw + 1) + x0];
          const i10 = grid[y0 * (gw + 1) + x0 + 1];
          const i01 = grid[(y0 + 1) * (gw + 1) + x0];
          const i11 = grid[(y0 + 1) * (gw + 1) + x0 + 1];
          const top = i00 + (i10 - i00) * fx;
          const bot = i01 + (i11 - i01) * fx;
          out[y * width + x] += amplitude * (top + (bot - top) * fy);
        }
      }
      totalAmp += amplitude;
      amplitude *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= totalAmp;
    return out;
  }

  const SPEC_WIDTH = 256;
  const SPEC_HEIGHT = 192;

  // Each generator returns { data, width, height, title }.
  const GENERATORS = [
    function harmonicChirps(seed) {
      // Horizontal chirp ridges with decaying harmonics (classic spectrogram).
      const data = new Float32Array(SPEC_WIDTH * SPEC_HEIGHT);
      const noise = valueNoise(SPEC_WIDTH, SPEC_HEIGHT, seed);
      for (let y = 0; y < SPEC_HEIGHT; y++) {
        for (let x = 0; x < SPEC_WIDTH; x++) {
          const u = x / (SPEC_WIDTH - 1);
          const v = y / (SPEC_HEIGHT - 1);
          let value = 0.12 * noise[y * SPEC_WIDTH + x];
          for (let h = 1; h <= 3; h++) {
            const center = 0.1 + 0.05 * h + 0.75 * u * u * (h / 3);
            const d = (v - center) * 14;
            value += (1.1 / h) * Math.exp(-d * d);
          }
          data[y * SPEC_WIDTH + x] = value;
        }
      }
      return { data, width: SPEC_WIDTH, height: SPEC_HEIGHT, title: 'A: chirp harmonics' };
    },
    function modulatedCarriers(seed) {
      // Vertical carrier bands with sinusoidal AM envelopes.
      const data = new Float32Array(SPEC_WIDTH * SPEC_HEIGHT);
      const noise = valueNoise(SPEC_WIDTH, SPEC_HEIGHT, seed);
      for (let y = 0; y < SPEC_HEIGHT; y++) {
        for (let x = 0; x < SPEC_WIDTH; x++) {
          const u = x / (SPEC_WIDTH - 1);
          const v = y / (SPEC_HEIGHT - 1);
          const carrier = Math.pow(0.5 + 0.5 * Math.sin(u * Math.PI * 9), 3);
          const envelope = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(v * Math.PI * 2.5 + u * 4), 2);
          data[y * SPEC_WIDTH + x] = carrier * envelope + 0.15 * noise[y * SPEC_WIDTH + x];
        }
      }
      return { data, width: SPEC_WIDTH, height: SPEC_HEIGHT, title: 'B: AM carriers' };
    },
    function driftingTones(seed) {
      // Diagonal drifting tones plus a broadband burst in the middle.
      const data = new Float32Array(SPEC_WIDTH * SPEC_HEIGHT);
      const noise = valueNoise(SPEC_WIDTH, SPEC_HEIGHT, seed);
      for (let y = 0; y < SPEC_HEIGHT; y++) {
        for (let x = 0; x < SPEC_WIDTH; x++) {
          const u = x / (SPEC_WIDTH - 1);
          const v = y / (SPEC_HEIGHT - 1);
          let value = 0.1 * noise[y * SPEC_WIDTH + x];
          for (let k = 0; k < 3; k++) {
            const center = 0.2 + 0.25 * k + 0.35 * u - 0.15 * k * u;
            const d = (v - center) * 18;
            value += 0.8 * Math.exp(-d * d);
          }
          const burst = Math.exp(-Math.pow((u - 0.5) * 6, 2));
          value += 0.5 * burst * (0.4 + 0.6 * noise[y * SPEC_WIDTH + x]);
          data[y * SPEC_WIDTH + x] = value;
        }
      }
      return { data, width: SPEC_WIDTH, height: SPEC_HEIGHT, title: 'C: drifting tones' };
    },
    function checkerResonances(seed) {
      // Localized resonance blobs on a low checkerboard background.
      const data = new Float32Array(SPEC_WIDTH * SPEC_HEIGHT);
      const noise = valueNoise(SPEC_WIDTH, SPEC_HEIGHT, seed);
      const rng = makeRng(seed ^ 0x9e3779b9);
      const blobs = [];
      for (let i = 0; i < 7; i++) {
        blobs.push([rng(), rng(), 0.05 + 0.08 * rng(), 0.5 + 0.7 * rng()]);
      }
      for (let y = 0; y < SPEC_HEIGHT; y++) {
        for (let x = 0; x < SPEC_WIDTH; x++) {
          const u = x / (SPEC_WIDTH - 1);
          const v = y / (SPEC_HEIGHT - 1);
          let value = 0.08 * (0.5 + 0.5 * Math.sin(u * 40) * Math.sin(v * 30));
          value += 0.1 * noise[y * SPEC_WIDTH + x];
          for (const [bu, bv, sigma, amp] of blobs) {
            const du = (u - bu) / sigma;
            const dv = (v - bv) / sigma;
            value += amp * Math.exp(-(du * du + dv * dv));
          }
          data[y * SPEC_WIDTH + x] = value;
        }
      }
      return { data, width: SPEC_WIDTH, height: SPEC_HEIGHT, title: 'D: resonances' };
    },
  ];

  function generateAll(seed) {
    return GENERATORS.map(function (gen, i) {
      return gen((seed + i * 7919) >>> 0);
    });
  }

  // ---------------------------------------------------------------------------
  // Sampling + rendering.
  // ---------------------------------------------------------------------------

  // Bilinear sample of a spectrogram at normalized coords (u, v) in [0,1].
  function sampleBilinear(spec, u, v) {
    const w = spec.width;
    const h = spec.height;
    const x = Math.min(w - 1.001, Math.max(0, u * (w - 1)));
    const y = Math.min(h - 1.001, Math.max(0, v * (h - 1)));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const d = spec.data;
    const i00 = d[y0 * w + x0];
    const i10 = d[y0 * w + x0 + 1];
    const i01 = d[(y0 + 1) * w + x0];
    const i11 = d[(y0 + 1) * w + x0 + 1];
    const top = i00 + (i10 - i00) * fx;
    const bot = i01 + (i11 - i01) * fx;
    return top + (bot - top) * fy;
  }

  // Render one subplot into a pixel buffer (Uint8ClampedArray RGBA) using the
  // SHARED color scale. Each subplot owns its rectangle exclusively, so no
  // pixel ever blends data from two subplots across a divider.
  function renderSubplot(spec, scale, out, outWidth, rect) {
    for (let py = 0; py < rect.height; py++) {
      const v = (py + 0.5) / rect.height;
      for (let px = 0; px < rect.width; px++) {
        const u = (px + 0.5) / rect.width;
        const value = sampleBilinear(spec, u, v);
        const rgb = scale(value);
        const idx = ((rect.y + py) * outWidth + (rect.x + px)) * 4;
        out[idx] = rgb[0];
        out[idx + 1] = rgb[1];
        out[idx + 2] = rgb[2];
        out[idx + 3] = 255;
      }
    }
  }

  // Quadrant rectangles for a canvas of size width x height split at
  // (dividerX, dividerY). Dividers are clamped so every quadrant keeps at
  // least `minSize` pixels.
  function quadrantRects(width, height, dividerX, dividerY, minSize) {
    const m = minSize || 20;
    const dx = Math.round(Math.min(width - m, Math.max(m, dividerX)));
    const dy = Math.round(Math.min(height - m, Math.max(m, dividerY)));
    return [
      { x: 0, y: 0, width: dx, height: dy },
      { x: dx, y: 0, width: width - dx, height: dy },
      { x: 0, y: dy, width: dx, height: height - dy },
      { x: dx, y: dy, width: width - dx, height: height - dy },
    ];
  }

  // Render all four subplots with one shared scale into a single RGBA buffer.
  function renderAll(specs, scale, width, height, dividerX, dividerY) {
    const out = new Uint8ClampedArray(width * height * 4);
    const rects = quadrantRects(width, height, dividerX, dividerY);
    for (let i = 0; i < 4; i++) {
      renderSubplot(specs[i], scale, out, width, rects[i]);
    }
    return { pixels: out, rects: rects };
  }

  // Values of every subplot at the same normalized position (for hover readout).
  function valuesAt(specs, u, v) {
    return specs.map(function (spec) {
      return sampleBilinear(spec, u, v);
    });
  }

  // ---------------------------------------------------------------------------
  // Parameter (de)serialization for the JSON export.
  // ---------------------------------------------------------------------------
  function defaultParams() {
    return {
      version: 1,
      seed: 12345,
      colormap: 'viridis',
      vmin: 0,
      vmax: 1.6,
      dividerX: 0.5, // fractions of canvas size
      dividerY: 0.5,
    };
  }

  function serializeParams(params) {
    return JSON.stringify(params, null, 2);
  }

  function parseParams(json) {
    const p = JSON.parse(json);
    if (!COLORMAPS[p.colormap]) throw new Error('bad colormap in params');
    if (!(p.vmax > p.vmin)) throw new Error('bad range in params');
    for (const key of ['dividerX', 'dividerY']) {
      if (!(p[key] > 0 && p[key] < 1)) throw new Error('bad ' + key);
    }
    return p;
  }

  const api = {
    COLORMAPS: COLORMAPS,
    makeColorScale: makeColorScale,
    generateAll: generateAll,
    sampleBilinear: sampleBilinear,
    renderSubplot: renderSubplot,
    renderAll: renderAll,
    quadrantRects: quadrantRects,
    valuesAt: valuesAt,
    defaultParams: defaultParams,
    serializeParams: serializeParams,
    parseParams: parseParams,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SpectroCore = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
