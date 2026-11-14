import test from "node:test";
import assert from "node:assert/strict";
import {
  CANVAS,
  DEFAULT_CONFIG,
  SAMPLE_CREDITS,
  buildCues,
  buildTimeline,
  buildTrackModel,
  buildWebVTT,
  createGeometry,
  getFadeAmount,
  formatVTTTime,
  scrollAtTime,
  slowFactorAtScroll,
  timeAtScroll,
  validateLayout,
} from "../js/timeline.js";

const measure = (text) => Array.from(text).length * DEFAULT_CONFIG.fontSize * 1.04;

function sample() {
  const model = buildTrackModel(SAMPLE_CREDITS, measure);
  const geometry = createGeometry(model, DEFAULT_CONFIG);
  const timeline = buildTimeline(geometry, DEFAULT_CONFIG);
  const cues = buildCues(model, geometry, timeline);
  const validation = validateLayout(model, geometry, timeline, DEFAULT_CONFIG, cues.length);
  return { model, geometry, timeline, cues, validation };
}

test("示例确实包含十行字幕与四个留白段", () => {
  const { model } = sample();
  assert.equal(model.lineCount, 10);
  assert.equal(model.blankCount, 4);
  assert.equal(model.groups.length, 5);
  assert.equal(model.rows.length, 14);
});

test("滚动起点在画面下方，结束点完全越过上边界", () => {
  const { geometry, timeline, validation } = sample();
  assert.equal(geometry.initialTop, CANVAS.height + DEFAULT_CONFIG.entryOffset);
  assert.equal(geometry.maxScroll, geometry.initialTop + geometry.trackHeight + DEFAULT_CONFIG.exitMargin);
  assert.ok(geometry.initialTop > CANVAS.height);
  assert.ok(geometry.initialTop - geometry.maxScroll + geometry.trackHeight < 0);
  assert.equal(validation.safe, true);
  assert.equal(validation.startBelowFrame, true);
  assert.equal(validation.lastLeavesFrame, true);
  assert.ok(timeline.duration > 30);
  assert.ok(timeline.duration < 45);
});

test("时间轴在末点准确回到最大滚动距离", () => {
  const { geometry, timeline } = sample();
  assert.equal(scrollAtTime(timeline, 0), 0);
  assert.equal(scrollAtTime(timeline, timeline.duration), geometry.maxScroll);
  assert.equal(timeAtScroll(timeline, geometry.maxScroll), timeline.duration);
  assert.ok(Number.isFinite(scrollAtTime(timeline, timeline.duration * 0.5)));
});

test("留白焦点区触发平滑减速，分段停留增加时长", () => {
  const { geometry, timeline } = sample();
  const holdScroll = geometry.holds[0].scroll;
  assert.ok(slowFactorAtScroll(geometry, holdScroll, DEFAULT_CONFIG) < 0.5);
  assert.ok(slowFactorAtScroll(geometry, holdScroll - 180, DEFAULT_CONFIG) > 0.99);

  const noHold = buildTimeline(geometry, { ...DEFAULT_CONFIG, hold: 0 });
  const expectedDifference = geometry.holds.length * DEFAULT_CONFIG.hold;
  assert.ok(Math.abs(timeline.duration - noHold.duration - expectedDifference) < 0.001);
});

test("五段 WebVTT 覆盖十行文本且时间戳有效", () => {
  const { cues, timeline } = sample();
  assert.equal(cues.length, 5);
  assert.equal(cues.reduce((total, cue) => total + cue.lines, 0), 10);
  assert.ok(cues.every((cue) => cue.start >= 0 && cue.end <= timeline.duration + 0.001));
  assert.ok(cues.every((cue) => /^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(formatVTTTime(cue.start))));

  const vtt = buildWebVTT(cues, timeline.duration);
  assert.ok(vtt.startsWith("WEBVTT\n"));
  assert.equal((vtt.match(/ --> /g) ?? []).length, 5);
  cues.forEach((cue) => assert.ok(vtt.includes(cue.text)));
});

test("超长单行会自动换行，视觉行宽度不越界", () => {
  const longLine = "这是一段很长的字幕文本".repeat(16);
  const model = buildTrackModel(longLine, measure);
  const geometry = createGeometry(model, DEFAULT_CONFIG);
  const timeline = buildTimeline(geometry, DEFAULT_CONFIG);
  const validation = validateLayout(model, geometry, timeline, DEFAULT_CONFIG);
  assert.ok(model.rows.length > 1);
  assert.ok(model.visualWidths.every((width) => width <= DEFAULT_CONFIG.maxTextWidth));
  assert.equal(validation.horizontalSafe, true);
});

test("十行字幕均位于横向安全宽度内", () => {
  const { validation } = sample();
  assert.equal(validation.checkedLineCount, 10);
  assert.equal(validation.horizontalSafe, true);
  assert.ok(validation.maxTextWidth < DEFAULT_CONFIG.maxTextWidth);
});

test("背景淡出在设定起点前保持透明，并在结尾完成", () => {
  const { timeline } = sample();
  const start = timeline.duration * DEFAULT_CONFIG.fadeStart;
  assert.equal(getFadeAmount(start - 1, timeline.duration, DEFAULT_CONFIG), 0);
  assert.equal(getFadeAmount(timeline.duration, timeline.duration, DEFAULT_CONFIG), 1);
  assert.equal(
    getFadeAmount(timeline.duration, timeline.duration, {
      ...DEFAULT_CONFIG,
      fadeEnabled: false,
    }),
    0
  );
});
