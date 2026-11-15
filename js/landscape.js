/*
 * landscape.js — 程序化风景图生成（纯数学，不依赖 DOM）。
 * 输出 { data, width, height }，浏览器端包成 ImageData，
 * Node 端直接编码 PNG，保证两处渲染结果一致。
 */
(function (global) {
  'use strict';

  function hash2(x, y) {
    var h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  // 一维值噪声
  function noise1(x, seed) {
    var i = Math.floor(x), f = x - i;
    var a = hash2(i, seed), b = hash2(i + 1, seed);
    return a + (b - a) * smooth(f);
  }

  function fbm1(x, seed, octaves) {
    var v = 0, amp = 0.5, freq = 1, norm = 0;
    for (var o = 0; o < octaves; o++) {
      v += noise1(x * freq, seed + o * 17.7) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return v / norm;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function mixColor(c1, c2, t) {
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  }

  /**
   * 生成风景图。opts: { width, height, seed }
   */
  function generateLandscape(opts) {
    var W = opts.width || 480;
    var H = opts.height || 300;
    var seed = opts.seed == null ? 7 : opts.seed;
    var data = new Uint8ClampedArray(W * H * 4);

    var horizon = Math.round(H * 0.62);
    var sunX = W * 0.74, sunY = H * 0.26, sunR = H * 0.10;

    var skyTop = [38, 72, 122];
    var skyMid = [126, 174, 214];
    var skyLow = [224, 238, 244];
    var sunTint = [255, 214, 150];

    // 山脊线（三层，远景到近景）
    var layers = [
      { base: horizon - H * 0.06, amp: H * 0.16, freq: 2.2, seed: seed + 11, col: [146, 168, 196] },
      { base: horizon - H * 0.02, amp: H * 0.20, freq: 3.1, seed: seed + 43, col: [96, 122, 158] },
      { base: horizon + H * 0.01, amp: H * 0.22, freq: 4.3, seed: seed + 91, col: [58, 82, 116] }
    ];
    var ridge = [];
    for (var li = 0; li < layers.length; li++) {
      var L = layers[li];
      var line = new Float32Array(W);
      for (var x = 0; x < W; x++) {
        var n = fbm1(x / W * L.freq * 3.0, L.seed, 4);
        var peak = 1 - Math.abs(2 * n - 1); // 尖峰山脊
        line[x] = L.base - peak * L.amp;
      }
      ridge.push(line);
    }

    for (var y = 0; y < H; y++) {
      for (var x2 = 0; x2 < W; x2++) {
        var r, g, b;
        if (y < horizon) {
          var t = y / horizon;
          var col = t < 0.55
            ? mixColor(skyTop, skyMid, t / 0.55)
            : mixColor(skyMid, skyLow, (t - 0.55) / 0.45);
          var dx = x2 - sunX, dy = y - sunY;
          var d = Math.sqrt(dx * dx + dy * dy);
          var glow = Math.exp(-(d * d) / (2 * sunR * sunR * 4));
          col = mixColor(col, sunTint, Math.min(1, glow * 0.85));
          if (d < sunR * 0.55) col = mixColor(col, [255, 246, 220], 0.95);
          var cloud = fbm1(x2 / W * 6 + y * 0.02, seed + 5, 3);
          var cloudMask = Math.max(0, cloud - 0.58) * 2.2 * (1 - t * 0.6);
          col = mixColor(col, [245, 248, 250], Math.min(0.5, cloudMask));
          r = col[0]; g = col[1]; b = col[2];
          for (var li2 = 0; li2 < layers.length; li2++) {
            var ry = ridge[li2][x2];
            if (y >= ry) {
              var depth = Math.min(1, (y - ry) / (H * 0.12));
              var shade = 1 - depth * 0.35;
              var tex = fbm1(x2 / W * 24 + li2 * 31, seed + li2 * 7, 3) * 0.16;
              var c = layers[li2].col;
              r = c[0] * shade * (1 - tex * 0.4);
              g = c[1] * shade * (1 - tex * 0.3);
              b = c[2] * shade * (1 - tex * 0.2);
            }
          }
        } else {
          var tw = (y - horizon) / (H - horizon);
          var refl = mixColor(skyLow, [30, 58, 92], Math.min(1, tw * 1.15));
          var ripple = fbm1(x2 / W * 30 + y * 0.35, seed + 77, 3);
          var band = Math.sin(y * 1.7 + ripple * 6.0) * 0.5 + 0.5;
          var rippleAmt = 0.10 + tw * 0.10;
          r = refl[0] * (1 - rippleAmt + band * rippleAmt);
          g = refl[1] * (1 - rippleAmt + band * rippleAmt);
          b = refl[2] * (1 - rippleAmt * 0.7 + band * rippleAmt * 0.7);
          var glint = Math.exp(-Math.pow((x2 - sunX) / (W * 0.05 + tw * W * 0.05), 2));
          var sparkle = hash2(x2 * 3.1, y * 5.7) > 0.82 ? 1 : 0.35;
          var gl = glint * (0.35 + 0.4 * band) * sparkle * (1 - tw * 0.4);
          r = lerp(r, 255, gl); g = lerp(g, 236, gl); b = lerp(b, 190, gl);
        }
        var grain = (hash2(x2 * 1.3, y * 1.7) - 0.5) * 5;
        var idx = (y * W + x2) * 4;
        data[idx] = r + grain;
        data[idx + 1] = g + grain;
        data[idx + 2] = b + grain;
        data[idx + 3] = 255;
      }
    }
    return { data: data, width: W, height: H };
  }

  var api = { generateLandscape: generateLandscape };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Landscape = api;
})(typeof window !== 'undefined' ? window : globalThis);
