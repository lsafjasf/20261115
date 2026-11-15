// Minimal 2D context stub implementing only the calls the Renderer makes.
// It records fill/fillText calls so draw-call counts can be asserted in Node.
export function createCanvasStub(width = 960, height = 600) {
  const calls = { fill: 0, fillText: 0, stateSave: 0, stateRestore: 0 };
  const ctx = {
    canvas: { width, height },
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save() { calls.stateSave++; },
    restore() { calls.stateRestore++; },
    translate() {},
    clearRect() {},
    beginPath() {},
    rect() {},
    arc() {},
    moveTo() {},
    arcTo() {},
    closePath() {},
    fill() { calls.fill++; },
    fillText() { calls.fillText++; },
    setTransform() {},
  };
  return { canvas: ctx.canvas, ctx, calls };
}
