import assert from "node:assert/strict";
import test from "node:test";

import {
  FACE_META,
  FACE_VERTICES,
  buildNet,
  createDefaultVertices,
} from "../src/geometry.js";
import { buildSvg } from "../src/svg.js";

function vertexIdsForFace(net, faceId) {
  const face = net.faces.find((item) => item.id === faceId);
  return [...face.vertexIds].sort((a, b) => a - b);
}

function polygonSignature(polygon) {
  return polygon.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join("|");
}

test("默认六面体生成有效的 A4 展开图", () => {
  const vertices = createDefaultVertices();
  const net = buildNet(vertices);

  assert.equal(vertices.length, 8);
  assert.equal(net.faces.length, 6);
  assert.equal(net.faces.length, FACE_META.length);
  assert.equal(net.tabs.length, 7);
  assert.equal(net.valid, true, net.errors.join("；"));
  assert.ok(net.bounds.width > 0);
  assert.ok(net.bounds.height > 0);

  for (const face of net.faces) {
    assert.ok(face.area > 0, `${face.id} 必须具有正面积`);
    assert.deepEqual(vertexIdsForFace(net, face.id), [...FACE_VERTICES[face.id]].sort((a, b) => a - b));
  }
});

test("修改 V6 后所有关联面板同步重建且编号保持不变", () => {
  const vertices = createDefaultVertices();
  const before = buildNet(vertices);
  vertices[6].position = [1.56, 1.08, 0.94];
  const after = buildNet(vertices);

  assert.equal(after.valid, true, after.errors.join("；"));
  assert.equal(after.faces.length, 6);
  assert.equal(after.tabs.length, 7);

  for (const faceId of ["F2", "F4", "F5"]) {
    const beforeFace = before.faces.find((face) => face.id === faceId);
    const afterFace = after.faces.find((face) => face.id === faceId);
    assert.notEqual(polygonSignature(beforeFace.polygon), polygonSignature(afterFace.polygon));
  }

  for (const faceId of ["F1", "F2", "F3", "F4", "F5", "F6"]) {
    assert.deepEqual(vertexIdsForFace(after, faceId), vertexIdsForFace(before, faceId));
    assert.ok(after.faces.find((face) => face.id === faceId).area > 0);
  }

  const movedPoint = after.vertexPoints.find((point) => point.id === 6);
  assert.ok(movedPoint);
  assert.notDeepEqual(movedPoint.position, before.vertexPoints.find((point) => point.id === 6).position);
});

test("会造成重叠的顶点位置被判定为无效", () => {
  const vertices = createDefaultVertices();
  vertices[6].position = [-2.7, 0, 0];
  const net = buildNet(vertices);

  assert.equal(net.valid, false);
  assert.ok(net.errors.some((message) => message.includes("重叠") || message.includes("自交")));
});

test("SVG 包含六个面板、七个舌片和独立折线组", () => {
  const net = buildNet(createDefaultVertices());
  const svg = buildSvg(net, { showVertexLabels: true, selectedVertex: 6 });

  assert.match(svg, /width="210mm" height="297mm"/);
  assert.match(svg, /viewBox="0 0 210 297"/);
  assert.match(svg, /id="panels"/);
  assert.match(svg, /id="fold-lines"/);
  assert.match(svg, /id="tabs"/);

  const panels = svg.match(/id="panels">([\s\S]*?)<\/g>/)[1];
  const tabs = svg.match(/id="tabs">([\s\S]*?)<\/g>/)[1];
  const folds = svg.match(/id="fold-lines"[^>]*>([\s\S]*?)<\/g>/)[1];
  assert.equal((panels.match(/<polygon/g) || []).length, 6);
  assert.equal((tabs.match(/<polygon/g) || []).length, 7);
  assert.ok((folds.match(/<path/g) || []).length >= 5);
  for (let id = 0; id < 8; id += 1) assert.match(svg, new RegExp(`>V${id}<`));
});
