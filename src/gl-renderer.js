// WebGL1 renderer: shaded terrain, pedestal and dynamic highlight overlay.

import { buildHeightfield, gridPoint } from './terrain.js';

const TERRAIN_VS = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uMVP;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;
void main() {
  vNormal = normalize(mat3(uModel) * aNormal);
  vColor = aColor;
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  gl_Position = uMVP * vec4(aPosition, 1.0);
}`;

const TERRAIN_FS = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;
void main() {
  vec3 light = normalize(vec3(0.45, 0.9, 0.35));
  float diffuse = max(dot(normalize(vNormal), light), 0.0);
  float shade = 0.38 + 0.62 * diffuse;
  vec3 color = vColor * shade;
  float fog = smoothstep(2.4, 4.2, length(vWorld.xz));
  gl_FragColor = vec4(mix(color, vec3(0.06, 0.08, 0.11), fog * 0.5), 1.0);
}`;

const FLAT_VS = `
attribute vec3 aPosition;
uniform mat4 uMVP;
void main() {
  gl_Position = uMVP * vec4(aPosition, 1.0);
}`;

const FLAT_FS = `
precision mediump float;
uniform vec4 uColor;
void main() {
  gl_FragColor = uColor;
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p));
  }
  return p;
}

function elevationColor(h) {
  const stops = [
    [0.16, 0.28, 0.34],
    [0.24, 0.46, 0.36],
    [0.55, 0.58, 0.32],
    [0.66, 0.45, 0.26],
    [0.82, 0.78, 0.7],
  ];
  const t = Math.max(0, Math.min(0.9999, h)) * (stops.length - 1);
  const k = Math.floor(t);
  const f = t - k;
  const a = stops[k];
  const b = stops[Math.min(k + 1, stops.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export class GLRenderer {
  constructor(canvas, resolution = 96) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {
      antialias: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.terrainProgram = program(gl, TERRAIN_VS, TERRAIN_FS);
    this.flatProgram = program(gl, FLAT_VS, FLAT_FS);
    this.field = buildHeightfield(resolution);
    this.buildTerrain();
    this.buildBase();
    this.highlightBuffer = gl.createBuffer();
    this.highlightCount = 0;
    this.depthFloat = this.probeDepthFormat(gl);
    gl.clearColor(0.045, 0.06, 0.085, 1);
    gl.enable(gl.DEPTH_TEST);
  }

  probeDepthFormat(gl) {
    const probe = new Float32Array(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.readPixels(0, 0, 1, 1, gl.DEPTH_COMPONENT, gl.FLOAT, probe);
    return gl.getError() === gl.NO_ERROR;
  }

  buildTerrain() {
    const { gl, field } = this;
    const n = field.n;
    const positions = [];
    const normals = [];
    const colors = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const [x, y, z] = gridPoint(field, i, j);
        const xl = gridPoint(field, Math.max(0, i - 1), j);
        const xr = gridPoint(field, Math.min(n - 1, i + 1), j);
        const zb = gridPoint(field, i, Math.max(0, j - 1));
        const zf = gridPoint(field, i, Math.min(n - 1, j + 1));
        const dx = (xr[1] - xl[1]) / (xr[0] - xl[0]);
        const dz = (zf[1] - zb[1]) / (zf[2] - zb[2]);
        let len = Math.hypot(dx, 1, dz);
        positions.push(x, y, z);
        normals.push(-dx / len, 1 / len, -dz / len);
        colors.push(...elevationColor(y));
      }
    }
    const indices = [];
    for (let j = 0; j < field.resolution; j++) {
      for (let i = 0; i < field.resolution; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    this.terrain = {
      position: this.makeBuffer(positions, gl.ARRAY_BUFFER),
      normal: this.makeBuffer(normals, gl.ARRAY_BUFFER),
      color: this.makeBuffer(colors, gl.ARRAY_BUFFER),
      index: this.makeBuffer(indices, gl.ELEMENT_ARRAY_BUFFER),
      count: indices.length,
    };
  }

  buildBase() {
    const { gl } = this;
    const top = -0.08;
    const bottom = -0.26;
    const corners = [
      [-1, top, -1], [1, top, -1], [1, top, 1], [-1, top, 1],
      [-1, bottom, -1], [1, bottom, -1], [1, bottom, 1], [-1, bottom, 1],
    ];
    const faces = [
      [0, 1, 2, 3], [4, 6, 5, 7], [0, 4, 5, 1],
      [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0],
    ];
    const verts = [];
    for (const f of faces) {
      const [a, b, c, d] = f.map((id) => corners[id]);
      verts.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    this.baseBuffer = this.makeBuffer(verts, gl.ARRAY_BUFFER);
    this.baseCount = verts.length / 3;
  }

  makeBuffer(data, target) {
    const { gl } = this;
    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, new Float32Array(data), gl.STATIC_DRAW);
    return buffer;
  }

  setHighlight(triangles) {
    const { gl } = this;
    const flat = triangles.flat();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.highlightBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(flat), gl.DYNAMIC_DRAW);
    this.highlightCount = flat.length / 3;
  }

  resize() {
    const dpr = Math.min(
      (typeof globalThis !== 'undefined' && globalThis.window?.devicePixelRatio) || 1,
      2,
    );
    const width = Math.round(this.canvas.clientWidth * dpr);
    const height = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return { width, height, dpr };
  }

  render(mvp, model) {
    const { gl } = this;
    const { width, height } = this.resize();
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawBase(mvp);
    this.drawTerrain(mvp, model);
    this.drawHighlight(mvp);
  }

  drawTerrain(mvp, model) {
    const { gl, terrain, terrainProgram } = this;
    gl.useProgram(terrainProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(terrainProgram, 'uMVP'), false, mvp);
    gl.uniformMatrix4fv(gl.getUniformLocation(terrainProgram, 'uModel'), false, model);
    this.attrib(terrainProgram, 'aPosition', terrain.position, 3);
    this.attrib(terrainProgram, 'aNormal', terrain.normal, 3);
    this.attrib(terrainProgram, 'aColor', terrain.color, 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrain.index);
    gl.drawElements(gl.TRIANGLES, terrain.count, gl.UNSIGNED_SHORT, 0);
  }

  drawBase(mvp) {
    const { gl, flatProgram } = this;
    gl.useProgram(flatProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(flatProgram, 'uMVP'), false, mvp);
    gl.uniform4f(gl.getUniformLocation(flatProgram, 'uColor'), 0.1, 0.12, 0.16, 1);
    this.attrib(flatProgram, 'aPosition', this.baseBuffer, 3);
    gl.drawArrays(gl.TRIANGLES, 0, this.baseCount);
  }

  drawHighlight(mvp) {
    const { gl, flatProgram } = this;
    if (!this.highlightCount) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.useProgram(flatProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(flatProgram, 'uMVP'), false, mvp);
    gl.uniform4f(gl.getUniformLocation(flatProgram, 'uColor'), 1.0, 0.55, 0.12, 0.34);
    this.attrib(flatProgram, 'aPosition', this.highlightBuffer, 3);
    gl.drawArrays(gl.TRIANGLES, 0, this.highlightCount);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  attrib(programName, name, buffer, size) {
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const loc = gl.getAttribLocation(programName, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  // Depth in window coordinates (0..1, larger = closer) for overlay occlusion.
  depthAt(pixelX, pixelY) {
    const { gl } = this;
    const x = Math.max(0, Math.min(this.canvas.width - 1, Math.round(pixelX)));
    const y = Math.max(0, Math.min(this.canvas.height - 1, Math.round(this.canvas.height - pixelY)));
    if (this.depthFloat) {
      const value = new Float32Array(1);
      gl.readPixels(x, y, 1, 1, gl.DEPTH_COMPONENT, gl.FLOAT, value);
      return value[0];
    }
    const value = new Uint16Array(1);
    gl.readPixels(x, y, 1, 1, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, value);
    return value[0] / 65535;
  }
}
