/*
 * water-renderer.js
 * WebGL 程序化水面渲染器。
 * 质量档仅影响 uOctaves 与画布像素分辨率（DPR），
 * 所有颜色 uniform 在各档位间保持一致，保证整体色相不变。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WaterRenderer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERT = [
    'attribute vec2 aPos;',
    'void main() { gl_Position = vec4(aPos, 0.0, 1.0); }',
  ].join('\n');

  const FRAG = [
    'precision highp float;',
    'uniform vec2 uResolution;',
    'uniform float uTime;',
    'uniform float uRippleScale;',
    'uniform float uDirRad;',
    'uniform vec3 uWaterColor;',
    'uniform vec3 uFogColor;',
    'uniform float uFogDensity;',
    'uniform float uReflection;',
    'uniform int uOctaves;',
    '',
    'float waveHeight(vec2 p, float t) {',
    '  float h = 0.0;',
    '  float amp = 1.0;',
    '  float freq = 1.0;',
    '  for (int i = 0; i < 4; i++) {',
    '    float w = step(float(i), float(uOctaves) - 0.5);',
    '    float a = uDirRad + float(i) * 0.9;',
    '    vec2 dir = vec2(cos(a), sin(a));',
    '    float phase = dot(p, dir) * freq * 1.6 + t * (0.9 + 0.25 * float(i));',
    '    h += (sin(phase) + 0.35 * sin(phase * 1.7 + float(i) * 2.1)) * amp * w;',
    '    amp *= 0.5;',
    '    freq *= 2.1;',
    '  }',
    '  return h;',
    '}',
    '',
    'vec3 skyColor(vec3 rd, vec3 sunDir) {',
    '  float up = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);',
    '  vec3 skyTint = vec3(0.30, 0.50, 0.72);',
    '  vec3 sky = mix(uFogColor, skyTint, pow(up, 1.4));',
    '  float sun = pow(max(dot(rd, sunDir), 0.0), 64.0);',
    '  return sky + sun * vec3(1.0, 0.92, 0.75) * 0.6;',
    '}',
    '',
    'void main() {',
    '  vec2 p = (gl_FragCoord.xy * 2.0 - uResolution) / uResolution.y;',
    '  vec3 ro = vec3(0.0, 1.6, -2.2);',
    '  vec3 ta = vec3(0.0, 0.55, 0.0);',
    '  vec3 ww = normalize(ta - ro);',
    '  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));',
    '  vec3 vv = cross(uu, ww);',
    '  vec3 rd = normalize(p.x * uu + p.y * vv + 1.2 * ww);',
    '  vec3 sunDir = normalize(vec3(-0.4, 0.55, 0.6));',
    '',
    '  if (rd.y >= 0.0) {',
    '    gl_FragColor = vec4(skyColor(rd, sunDir), 1.0);',
    '    return;',
    '  }',
    '  float tHit = -ro.y / rd.y;',
    '  vec3 pos = ro + rd * tHit;',
    '  vec2 wp = pos.xz * uRippleScale;',
    '  float t = uTime;',
    '  float h = waveHeight(wp, t);',
    '  float e = 0.08;',
    '  float hx = waveHeight(wp + vec2(e, 0.0), t) - h;',
    '  float hz = waveHeight(wp + vec2(0.0, e), t) - h;',
    '  vec3 n = normalize(vec3(-hx, 2.0 * e, -hz));',
    '',
    '  float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);',
    '  vec3 reflDir = reflect(rd, n);',
    '  vec3 refl = skyColor(reflDir, sunDir);',
    '  float spec = pow(max(dot(reflDir, sunDir), 0.0), 90.0);',
    '  float reflMix = clamp(fresnel * 0.7 + 0.08, 0.0, 1.0) * uReflection;',
    '  vec3 color = mix(uWaterColor, refl, reflMix);',
    '  color += spec * vec3(1.0, 0.95, 0.8) * uReflection * 0.8;',
    '  color *= 0.85 + 0.15 * max(dot(n, sunDir), 0.0);',
    '',
    '  float fog = 1.0 - exp(-uFogDensity * tHit);',
    '  color = mix(color, uFogColor, clamp(fog, 0.0, 1.0));',
    '  gl_FragColor = vec4(color, 1.0);',
    '}',
  ].join('\n');

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('着色器编译失败: ' + log);
    }
    return shader;
  }

  function createProgram(gl) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(program));
    }
    return program;
  }

  // 依赖注入 hexToRgb，保持渲染器与核心解耦，方便 Node 下做模块级测试。
  function createRenderer(canvas, core) {
    const gl =
      canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false }) ||
      canvas.getContext('experimental-webgl', { antialias: false });
    if (!gl) {
      throw new Error('当前设备不支持 WebGL');
    }
    const program = createProgram(gl);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uniformNames = [
      'uResolution', 'uTime', 'uRippleScale', 'uDirRad', 'uWaterColor',
      'uFogColor', 'uFogDensity', 'uReflection', 'uOctaves',
    ];
    const uniforms = {};
    uniformNames.forEach((name) => {
      uniforms[name] = gl.getUniformLocation(program, name);
    });

    const state = {
      gl: gl,
      canvas: canvas,
      width: 0,
      height: 0,
      dprCap: core.QUALITY_TIERS.high.dprCap,
      octaves: core.QUALITY_TIERS.high.octaves,
      tier: 'high',
    };

    const api = {
      resize(cssWidth, cssHeight, devicePixelRatio) {
        const dpr = Math.min(Math.max(0, devicePixelRatio || 1), state.dprCap);
        const w = Math.max(1, Math.round(cssWidth * dpr));
        const h = Math.max(1, Math.round(cssHeight * dpr));
        if (w !== state.width || h !== state.height) {
          state.width = w;
          state.height = h;
          canvas.width = w;
          canvas.height = h;
          gl.viewport(0, 0, w, h);
        }
      },
      setQuality(tier) {
        const q = core.QUALITY_TIERS[tier] || core.QUALITY_TIERS.high;
        state.tier = tier;
        state.octaves = q.octaves;
        state.dprCap = q.dprCap;
      },
      getQuality() {
        return state.tier;
      },
      // 颜色在此处统一转换；质量切换不会调用本方法，因此颜色逐字节稳定。
      applyParams(params, timeSec) {
        const water = core.hexToRgb(params.waterColor);
        const fog = core.hexToRgb(params.fogColor);
        gl.uniform2f(uniforms.uResolution, state.width, state.height);
        gl.uniform1f(uniforms.uTime, timeSec);
        gl.uniform1f(uniforms.uRippleScale, params.rippleScale);
        gl.uniform1f(uniforms.uDirRad, (params.direction * Math.PI) / 180);
        gl.uniform3f(uniforms.uWaterColor, water.r, water.g, water.b);
        gl.uniform3f(uniforms.uFogColor, fog.r, fog.g, fog.b);
        gl.uniform1f(uniforms.uFogDensity, params.fogDensity);
        gl.uniform1f(uniforms.uReflection, params.reflection);
        gl.uniform1i(uniforms.uOctaves, state.octaves);
      },
      render(timeSec) {
        gl.uniform1f(uniforms.uTime, timeSec);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      readPixels() {
        const n = state.width * state.height * 4;
        const pixels = new Uint8Array(n);
        gl.readPixels(0, 0, state.width, state.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return new Uint8ClampedArray(pixels);
      },
      getSize() {
        return { width: state.width, height: state.height };
      },
      dispose() {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      },
    };
    return api;
  }

  return { createRenderer: createRenderer, VERT: VERT, FRAG: FRAG };
});
