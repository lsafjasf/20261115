/*
 * stretch.js — 三段式横向延展核心算法（纯数学，不依赖 DOM）。
 *
 * 关键点：
 * 1. 区域内部用双线性插值重采样，绝不整列复制像素。
 * 2. 区域边界两侧各取一个混合带，对左右区域的外推采样做 smoothstep
 *    交叉淡化，实现颜色混合，消除接缝。
 * 3. 外推时源坐标做镜像反射（三角波折返），纹理得以延续而不是
 *    重复同一列；同时把源图的高频细节层按拉伸强度叠加回去，
 *    强拉伸时纹理依然连续。
 * 4. 输出加微量确定性抖动，避免天空等平滑区域出现色带。
 */
(function (global) {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function smoothstep(t) { return t * t * (3 - 2 * t); }

  // 三角波折返：把任意 t 映射进 [0,1]，边界处镜像延续
  function fold(t) {
    var m = t % 2;
    if (m < 0) m += 2;
    return m <= 1 ? m : 2 - m;
  }

  function hash2(x, y) {
    var h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return h - Math.floor(h);
  }

  // 可分离盒式模糊（两遍近似高斯），用于提取细节层
  function boxBlur(src, w, h, radius) {
    var tmp = new Float32Array(w * h * 3);
    var out = new Float32Array(w * h * 3);
    var win = radius * 2 + 1;
    var x, y, c, i, acc;
    for (y = 0; y < h; y++) {
      for (c = 0; c < 3; c++) {
        acc = 0;
        for (i = -radius; i <= radius; i++) {
          acc += src[(y * w + clamp(i, 0, w - 1)) * 4 + c];
        }
        for (x = 0; x < w; x++) {
          tmp[(y * w + x) * 3 + c] = acc / win;
          var xAdd = clamp(x + radius + 1, 0, w - 1);
          var xSub = clamp(x - radius, 0, w - 1);
          acc += src[(y * w + xAdd) * 4 + c] - src[(y * w + xSub) * 4 + c];
        }
      }
    }
    for (x = 0; x < w; x++) {
      for (c = 0; c < 3; c++) {
        acc = 0;
        for (i = -radius; i <= radius; i++) {
          acc += tmp[(clamp(i, 0, h - 1) * w + x) * 3 + c];
        }
        for (y = 0; y < h; y++) {
          out[(y * w + x) * 3 + c] = acc / win;
          var yAdd = clamp(y + radius + 1, 0, h - 1);
          var ySub = clamp(y - radius, 0, h - 1);
          acc += tmp[(yAdd * w + x) * 3 + c] - tmp[(ySub * w + x) * 3 + c];
        }
      }
    }
    return out;
  }

  /**
   * 延展图像。
   * src: { data: Uint8ClampedArray, width, height }
   * boundaries: [b1, b2] 源图中的区域分界 x
   * targetWidths: [w0, w1, w2] 三个区域延展后的宽度
   * opts: { blend (边界混合带半宽上限), detail (细节回加强度 0..1), dither }
   * 返回 { data, width, height, offsets: [o1, o2] }（offsets 为新分界位置）
   */
  function stretchImage(src, boundaries, targetWidths, opts) {
    opts = opts || {};
    var W = src.width, H = src.height;
    var sd = src.data;
    var starts = [0, boundaries[0], boundaries[1]];
    var srcWs = [boundaries[0], boundaries[1] - boundaries[0], W - boundaries[1]];
    var dstWs = targetWidths.slice();
    var outW = dstWs[0] + dstWs[1] + dstWs[2];
    var offsets = [dstWs[0], dstWs[0] + dstWs[1]];
    var out = new Uint8ClampedArray(outW * H * 4);

    var blur = boxBlur(sd, W, H, 3);
    // 细节层 = 原图 - 模糊图（高频纹理）
    var detail = new Float32Array(W * H * 3);
    for (var i = 0; i < W * H; i++) {
      for (var c = 0; c < 3; c++) {
        detail[i * 3 + c] = sd[i * 4 + c] - blur[i * 3 + c];
      }
    }

    // 每个区域的细节回加系数：拉伸越狠补得越多
    var detailGain = [0, 1, 2].map(function (r) {
      var ratio = dstWs[r] / srcWs[r];
      return clamp((ratio - 1) * 0.9, 0, 1) * (opts.detail == null ? 1 : opts.detail);
    });

    var blendMax = opts.blend == null ? 26 : opts.blend;
    // 每条边界的混合带半宽
    var half = [0, 1].map(function (k) {
      return Math.round(clamp(Math.min(dstWs[k], dstWs[k + 1]) / 4, 8, blendMax));
    });

    // 双线性采样（fx, fy 为源图浮点坐标，已折返到合法范围）
    function sampleColor(fx, fy, out3) {
      var x0 = Math.floor(fx), y0 = Math.floor(fy);
      var tx = fx - x0, ty = fy - y0;
      var x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1);
      x0 = clamp(x0, 0, W - 1); y0 = clamp(y0, 0, H - 1);
      var i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4;
      var i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
      for (var c = 0; c < 3; c++) {
        var a = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * tx;
        var b = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * tx;
        out3[c] = a + (b - a) * ty;
      }
    }

    function sampleDetail(fx, fy, out3) {
      var xi = clamp(Math.round(fx), 0, W - 1);
      var yi = clamp(Math.round(fy), 0, H - 1);
      var idx = (yi * W + xi) * 3;
      out3[0] = detail[idx]; out3[1] = detail[idx + 1]; out3[2] = detail[idx + 2];
    }

    // 区域 r 在输出 x 处的源坐标（超出区域时镜像折返，纹理延续）
    function mapX(r, x, origin) {
      var t = (x - origin) / dstWs[r];
      return starts[r] + fold(t) * srcWs[r];
    }

    var colA = [0, 0, 0], colB = [0, 0, 0], det = [0, 0, 0];
    var origins = [0, offsets[0], offsets[1]];

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < outW; x++) {
        // 所在区域
        var r = x < offsets[0] ? 0 : (x < offsets[1] ? 1 : 2);
        var gain = detailGain[r];
        var fx = mapX(r, x, origins[r]);
        sampleColor(fx, y, colA);

        // 边界混合带：与相邻区域的外推采样交叉淡化
        for (var k = 0; k < 2; k++) {
          var P = offsets[k], h = half[k];
          if (h > 0 && x >= P - h && x < P + h) {
            var wMix = smoothstep((x - (P - h)) / (2 * h));
            // 左区域向右外推 / 右区域向左外推
            var fxL = mapX(k, x, origins[k]);
            var fxR = mapX(k + 1, x, origins[k + 1]);
            sampleColor(fxL, y, colA);
            sampleColor(fxR, y, colB);
            for (var c2 = 0; c2 < 3; c2++) {
              colA[c2] = colA[c2] + (colB[c2] - colA[c2]) * wMix;
            }
            gain = Math.max(detailGain[k], detailGain[k + 1]);
            fx = wMix < 0.5 ? fxL : fxR;
          }
        }

        // 细节回加（纹理延续），坐标同样折返，不会整列重复
        if (gain > 0.001) {
          sampleDetail(fx, y, det);
          for (var c3 = 0; c3 < 3; c3++) colA[c3] += det[c3] * gain;
        }

        // 确定性抖动，抑制平滑渐变的色带
        var dth = (hash2(x, y) - 0.5) * (opts.dither == null ? 2.0 : opts.dither);
        var oi = (y * outW + x) * 4;
        out[oi] = colA[0] + dth;
        out[oi + 1] = colA[1] + dth;
        out[oi + 2] = colA[2] + dth;
        out[oi + 3] = 255;
      }
    }
    return { data: out, width: outW, height: H, offsets: offsets };
  }

  /**
   * 在图像上绘制区域标记（虚线分界 + 顶部色条），浏览器/Node 通用。
   * offsets: 分界 x 数组；labels 由调用方在浏览器端额外绘制文字。
   */
  function drawMarkers(img, offsets) {
    var d = img.data, W = img.width, H = img.height;
    var tints = [[255, 120, 90], [90, 200, 140], [110, 150, 255]];
    var starts = [0].concat(offsets);
    // 顶部 12px 半透明色条，标识左/中/右三块原始区域
    for (var r = 0; r < 3; r++) {
      var x0 = starts[r];
      var x1 = r < 2 ? offsets[r] : W;
      for (var y = 0; y < 12; y++) {
        for (var x = x0; x < x1; x++) {
          var i = (y * W + x) * 4;
          var a = 0.45;
          d[i] = d[i] * (1 - a) + tints[r][0] * a;
          d[i + 1] = d[i + 1] * (1 - a) + tints[r][1] * a;
          d[i + 2] = d[i + 2] * (1 - a) + tints[r][2] * a;
        }
      }
    }
    // 分界虚线（黑白交替，任何背景都可见）
    for (var k = 0; k < offsets.length; k++) {
      var bx = offsets[k];
      for (var y2 = 0; y2 < H; y2++) {
        if (Math.floor(y2 / 6) % 2 !== 0) continue;
        for (var dx = 0; dx < 2; dx++) {
          var xx = bx + dx;
          if (xx < 0 || xx >= W) continue;
          var ii = (y2 * W + xx) * 4;
          var v = (Math.floor(y2 / 12) % 2 === 0) ? 255 : 20;
          d[ii] = v; d[ii + 1] = v; d[ii + 2] = v;
        }
      }
    }
  }

  var api = { stretchImage: stretchImage, drawMarkers: drawMarkers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Stretch = api;
})(typeof window !== 'undefined' ? window : globalThis);
