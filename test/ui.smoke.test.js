// Smoke test: run the browser entry point against DOM/canvas stubs to
// prove the rendering and report pipeline executes without errors.

import { test } from "node:test";
import assert from "node:assert/strict";

function makeCtx() {
  return new Proxy({}, {
    get(target, prop) {
      if (!(prop in target)) target[prop] = () => {};
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

function makeEl() {
  return {
    checked: true,
    value: "348",
    dataset: {},
    innerHTML: "",
    width: 768,
    height: 512,
    getContext: () => makeCtx(),
    addEventListener: () => {},
  };
}

test("app.js boots and renders a failing seed without errors", async () => {
  const els = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeEl());
      return els.get(id);
    },
    querySelectorAll: () => [],
  };
  await import("../js/app.js");
  const report = els.get("report").innerHTML;
  assert.ok(report.includes("确定性"), "determinism section rendered");
  assert.ok(report.includes("不可达"), "unreachable goal reported");
  assert.ok(report.includes("阻断"), "blocker section rendered");
  assert.ok(report.includes("349"), "fixed seed proposed");
  assert.ok(els.get("legend").innerHTML.includes("起点"), "legend rendered");
});
