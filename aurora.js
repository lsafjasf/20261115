/* 极光生成器：Canvas 2D + 种子噪声
 * 纯函数部分（PRNG / 噪声 / 光带几何）同时可被 Node 引用做确定性测试。
 */
(function (global) {
  "use strict";

  // ---------- 确定性随机 ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashInt(i, seed) {
    let h = (i * 374761393 + seed * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // ---------- 一维值噪声 + 分形叠加 ----------
  function makeNoise1D(seed) {
    const s = seed | 0;
    return function (x) {
      const xi = Math.floor(x);
      const t = x - xi;
      const u = t * t * (3 - 2 * t);
      const a = hashInt(xi, s);
      const b = hashInt(xi + 1, s);
      return a + (b - a) * u;
    };
  }

  function makeFbm(seed, octaves) {
    const noise = makeNoise1D(seed);
    return function (x) {
      let sum = 0;
      let amp = 0.5;
      let freq = 1;
      let norm = 0;
      for (let o = 0; o < octaves; o++) {
        sum += amp * noise(x * freq + o * 17.17);
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
      }
      return sum / norm;
    };
  }

  // ---------- 参数 ----------
  const DEFAULTS = {
    seedA: 20261115,
    seedB: 417,
    compare: false,
    height: 55,     // 光带整体高度 0..100
    curvature: 45,  // 弯曲度 0..100
    density: 60,    // 密度（光柱数量/强度）5..100
    coolShift: 30,  // 冷色偏移 0..100（绿 -> 青蓝紫）
    fog: 35,        // 雾层浓度 0..100
    time: 0,        // 时间轴 0..1
  };

  const BAND_COUNT = 3;

  // 单条光带在 x（0..1 归一化）处的几何与强度
  function bandShape(bandIndex, x, p, seed) {
    const phase = seed * 0.013 + bandIndex * 31.7;
    const drift = p.time * 6.0; // 时间轴驱动的缓慢漂移
    const fbmPath = makeFbm(seed + bandIndex * 101 + 7, 4);
    const fbmThick = makeFbm(seed + bandIndex * 211 + 13, 3);
    const fbmRay = makeFbm(seed + bandIndex * 307 + 29, 3);

    const curveAmp = 0.04 + (p.curvature / 100) * 0.22;
    const curveFreq = 1.2 + (p.curvature / 100) * 3.0;
    const wobble =
      (fbmPath(x * curveFreq + phase + drift) - 0.5) * 2 * curveAmp;

    const baseY = 0.62 - (p.height / 100) * 0.34 - bandIndex * 0.085;
    const centerY = baseY + wobble;

    const thickness =
      0.05 +
      0.06 * fbmThick(x * 2.4 + phase * 1.3 + drift * 0.6) +
      bandIndex * 0.012;

    // 密度：垂直光柱的占空比与峰值强度
    const ray = fbmRay(x * (8 + p.density * 0.35) + phase * 2.1 + drift);
    const gate = 1 - p.density / 160; // 密度越高，门槛越低
    const rayIntensity = Math.pow(Math.max(0, (ray - gate) / (1 - gate)), 0.7);

    return {
      top: centerY - thickness,
      bottom: centerY + thickness * 0.6,
      intensity: 0.45 + 0.55 * rayIntensity,
    };
  }

  const AuroraCore = {
    mulberry32,
    makeNoise1D,
    makeFbm,
    bandShape,
    DEFAULTS,
    BAND_COUNT,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = AuroraCore;
  }
  global.AuroraCore = AuroraCore;

  // ---------- 场景渲染 ----------
  function drawSky(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#02030a");
    g.addColorStop(0.55, "#071228");
    g.addColorStop(1, "#0d1d33");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function drawStars(ctx, w, h, seed, time) {
    const rand = mulberry32(seed ^ 0x9e3779b9);
    const count = Math.floor((w * h) / 2600);
    ctx.save();
    for (let i = 0; i < count; i++) {
      const x = rand() * w;
      const y = rand() * h * 0.72;
      const r = rand() * 1.1 + 0.3;
      const tw = 0.5 + 0.5 * Math.sin(time * 12.56 + rand() * 6.28);
      ctx.globalAlpha = 0.25 + 0.55 * tw * rand();
      ctx.fillStyle = rand() > 0.85 ? "#cfe4ff" : "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------- 山脊（遮挡层） ----------
  function ridgeY(nx, seed, base, amp) {
    const fbm = makeFbm(seed, 4);
    return base - fbm(nx * 3.1 + seed * 0.001) * amp;
  }

  function drawMountains(ctx, w, h, seed) {
    const layers = [
      { seed: seed + 501, base: h * 0.86, amp: h * 0.16, color: "#101a2c" },
      { seed: seed + 907, base: h * 0.97, amp: h * 0.2, color: "#070c16" },
    ];
    for (const L of layers) {
      ctx.fillStyle = L.color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 3) {
        ctx.lineTo(x, ridgeY(x / w, L.seed, L.base, L.amp));
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ---------- 雾层（降低饱和度） ----------
  function drawFog(ctx, w, h, fogAmount, seed, time) {
    if (fogAmount <= 0) return;
    const f = fogAmount / 100;
    const fbm = makeFbm(seed + 733, 3);

    // 低饱和度灰白色雾带，贴近地平线，随时间缓慢流动
    ctx.save();
    const bands = 3;
    for (let i = 0; i < bands; i++) {
      const yBase = h * (0.68 + i * 0.1);
      const alpha = f * (0.1 + i * 0.05);
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) {
        const n = fbm(x / w * 4 + i * 9.3 + time * 1.5);
        ctx.lineTo(x, yBase + (n - 0.5) * h * 0.06);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = "rgba(168,178,190," + alpha.toFixed(3) + ")";
      ctx.fill();
    }

    // 全局降饱和：saturation 混合模式叠加灰色
    if (typeof ctx.globalCompositeOperation !== "undefined") {
      ctx.globalCompositeOperation = "saturation";
      ctx.fillStyle = "rgba(128,128,128," + (f * 0.55).toFixed(3) + ")";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();
  }

  // ---------- 整帧 ----------
  function renderScene(ctx, w, h, p, seed, region) {
    const rx = region ? region.x : 0;
    const rw = region ? region.w : w;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, 0, rw, h);
    ctx.clip();
    ctx.translate(rx, 0);
    drawSky(ctx, rw, h);
    drawStars(ctx, rw, h, seed, p.time);
    drawAurora(ctx, rw, h, p, seed);
    drawMountains(ctx, rw, h, seed);
    drawFog(ctx, rw, h, p.fog, seed, p.time);
    ctx.restore();
  }

  function render(ctx, w, h, p) {
    ctx.clearRect(0, 0, w, h);
    if (p.compare) {
      const half = Math.floor(w / 2);
      renderScene(ctx, w, h, p, p.seedA, { x: 0, w: half });
      renderScene(ctx, w, h, p, p.seedB, { x: half, w: w - half });
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(half + 0.5, 0);
      ctx.lineTo(half + 0.5, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "14px sans-serif";
      ctx.fillText("Seed A: " + p.seedA, 12, 22);
      ctx.fillText("Seed B: " + p.seedB, half + 12, 22);
      ctx.restore();
    } else {
      renderScene(ctx, w, h, p, p.seedA, null);
    }
  }

  AuroraCore.render = render;
  AuroraCore.renderScene = renderScene;

  // ---------- 浏览器 UI ----------
  if (typeof document === "undefined") return;

  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");
  const params = Object.assign({}, DEFAULTS);
  let playing = false;
  let lastFrame = 0;

  const $ = function (id) { return document.getElementById(id); };
  const sliders = ["height", "curvature", "density", "coolShift", "fog"];

  function syncOutputs() {
    sliders.forEach(function (k) { $(k + "Out").textContent = params[k]; });
    $("timeLabel").textContent = "t = " + params.time.toFixed(3);
  }

  function draw() {
    render(ctx, canvas.width, canvas.height, params);
    syncOutputs();
  }

  sliders.forEach(function (k) {
    $(k).addEventListener("input", function (e) {
      params[k] = Number(e.target.value);
      draw();
    });
  });

  $("seedA").addEventListener("input", function (e) {
    params.seedA = Number(e.target.value) || 0;
    draw();
  });
  $("seedB").addEventListener("input", function (e) {
    params.seedB = Number(e.target.value) || 0;
    draw();
  });
  $("compare").addEventListener("change", function (e) {
    params.compare = e.target.checked;
    draw();
  });

  $("time").addEventListener("input", function (e) {
    params.time = Number(e.target.value) / 1000;
    draw();
  });

  $("play").addEventListener("click", function () {
    playing = !playing;
    $("play").textContent = playing ? "⏸ 暂停" : "▶ 播放";
    if (playing) {
      lastFrame = performance.now();
      requestAnimationFrame(tick);
    }
  });

  function tick(now) {
    if (!playing) return;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    params.time = (params.time + dt * 0.02) % 1; // 缓慢变化
    $("time").value = Math.round(params.time * 1000);
    draw();
    requestAnimationFrame(tick);
  }

  // ---------- 导出 ----------
  function download(url, name) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }

  $("screenshot").addEventListener("click", function () {
    canvas.toBlob(function (blob) {
      download(URL.createObjectURL(blob), "aurora_" + params.seedA + ".png");
    }, "image/png");
  });

  $("saveJson").addEventListener("click", function () {
    const blob = new Blob([JSON.stringify(params, null, 2)], {
      type: "application/json",
    });
    download(URL.createObjectURL(blob), "aurora_params.json");
  });

  $("loadJson").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        applyParams(JSON.parse(reader.result));
      } catch (err) {
        $("checkResult").textContent = "JSON 解析失败：" + err.message;
        $("checkResult").className = "result fail";
      }
    };
    reader.readAsText(file);
  });

  function applyParams(data) {
    Object.keys(DEFAULTS).forEach(function (k) {
      if (k in data) params[k] = data[k];
    });
    sliders.forEach(function (k) { $(k).value = params[k]; });
    $("seedA").value = params.seedA;
    $("seedB").value = params.seedB;
    $("compare").checked = !!params.compare;
    $("time").value = Math.round(params.time * 1000);
    draw();
  }

  // ---------- 重载一致性检查 ----------
  // 用相同参数在离屏画布上独立渲染两次（模拟重新载入），逐像素比对。
  $("checkConsistency").addEventListener("click", function () {
    const a = document.createElement("canvas");
    const b = document.createElement("canvas");
    a.width = b.width = canvas.width;
    a.height = b.height = canvas.height;
    render(a.getContext("2d"), a.width, a.height, params);
    render(b.getContext("2d"), b.width, b.height, params);
    const da = a.getContext("2d").getImageData(0, 0, a.width, a.height).data;
    const db = b.getContext("2d").getImageData(0, 0, b.width, b.height).data;
    let diff = 0;
    for (let i = 0; i < da.length; i++) {
      if (da[i] !== db[i]) diff++;
    }
    const el = $("checkResult");
    if (diff === 0) {
      el.textContent = "✓ 两次渲染逐像素一致，光带形状确定可复现。";
      el.className = "result ok";
    } else {
      el.textContent = "✗ 发现 " + diff + " 个字节差异，请检查随机源。";
      el.className = "result fail";
    }
  });

  draw();
})(typeof window !== "undefined" ? window : globalThis);

  function bandColor(bandIndex, coolShift, lightness, alpha) {
    // 基础绿色 ~145，冷色偏移推向青/蓝/紫
    const hue =
      145 + (coolShift / 100) * 95 + bandIndex * (10 + coolShift * 0.12);
    const sat = 90 - (coolShift / 100) * 15;
    return "hsla(" + hue.toFixed(1) + "," + sat.toFixed(0) + "%," +
      lightness + "%," + alpha.toFixed(3) + ")";
  }

  function drawAurora(ctx, w, h, p, seed) {
    const step = 2;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let b = 0; b < BAND_COUNT; b++) {
      for (let x = 0; x < w; x += step) {
        const nx = x / w;
        const s = bandShape(b, nx, p, seed);
        const yTop = s.top * h;
        const yBot = s.bottom * h;
        if (yBot < 0 || yTop > h) continue;
        const g = ctx.createLinearGradient(0, yTop, 0, yBot);
        const a = s.intensity * (0.9 - b * 0.14);
        g.addColorStop(0, bandColor(b, p.coolShift, 62, 0));
        g.addColorStop(0.35, bandColor(b, p.coolShift, 58, a));
        g.addColorStop(0.75, bandColor(b, p.coolShift, 45, a * 0.45));
        g.addColorStop(1, bandColor(b, p.coolShift, 40, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x, yTop, step, yBot - yTop);
      }
    }
    ctx.restore();
  }
