import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STATE,
  HEAD_RADIUS,
  PRESET_MEASUREMENTS,
  ROOM,
  SPEED_OF_SOUND,
  applyPreset,
  buildSpatialState,
  distance,
  firstOrderReflections,
  getEarPositions,
} from "../src/geometry.js";

test("listener ears rotate with heading", () => {
  const listener = { x: 5, y: 3.5, yaw: 0 };
  const forward = getEarPositions(listener);
  assert.ok(Math.abs(forward.left.x - 5) < 1e-9);
  assert.ok(forward.left.y < listener.y);
  assert.ok(Math.abs(distance(forward.left, listener) - HEAD_RADIUS) < 1e-9);

  const turned = getEarPositions({ ...listener, yaw: 90 });
  assert.ok(turned.left.x > listener.x);
  assert.ok(Math.abs(turned.left.y - listener.y) < 1e-9);
  assert.ok(Math.abs(forward.right.y - 3.59) < 1e-9);
  assert.ok(Math.abs(turned.left.x - 5.09) < 1e-9);
});

test("first order reflections preserve image-source path length", () => {
  const emitter = { x: 1.2, y: 1.1 };
  const receiver = { x: 6.4, y: 5.3 };
  const paths = firstOrderReflections(emitter, receiver, 0.22, 4);
  assert.equal(paths.length, 4);
  for (const path of paths) {
    const segmented = path.points
      .slice(1)
      .reduce((sum, point, index) => sum + distance(path.points[index], point), 0);
    assert.ok(Math.abs(segmented - path.distance) < 1e-9);
    assert.ok(Math.abs(path.delayMs - path.distance / SPEED_OF_SOUND * 1000) < 1e-9);
  }
});

test("three presets stay inside the room and expose a TDOA", () => {
  for (const preset of PRESET_MEASUREMENTS) {
    const spatial = buildSpatialState(applyPreset(DEFAULT_STATE, preset));
    const { listener, source } = spatial.state;
    assert.ok(listener.x > 0 && listener.x < ROOM.width);
    assert.ok(listener.y > 0 && listener.y < ROOM.depth);
    assert.ok(source.x > 0 && source.x < ROOM.width);
    assert.ok(source.y > 0 && source.y < ROOM.depth);
    assert.equal(spatial.activeChannels.length, 4);
    assert.ok(spatial.pathTDOA > 0);
  }
});

test("yaw change updates ear choice and predicted delay", () => {
  const spatialA = buildSpatialState({
    ...DEFAULT_STATE,
    listener: { x: 2.15, y: 5.25, yaw: 20 },
  });
  const spatialB = buildSpatialState({
    ...DEFAULT_STATE,
    listener: { x: 2.15, y: 5.25, yaw: 140 },
  });
  const channelA = spatialA.channels.find((channel) => channel.id === "P1");
  const channelB = spatialB.channels.find((channel) => channel.id === "P1");
  assert.notEqual(channelA.nearSide, channelB.nearSide);
  assert.notEqual(channelA.diagramDelayMs, channelB.diagramDelayMs);
  assert.ok(Math.abs(spatialA.pathTDOA - spatialB.pathTDOA) > 0.1);
});
