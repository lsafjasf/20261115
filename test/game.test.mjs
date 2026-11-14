import assert from "node:assert/strict";
import test from "node:test";
import {
  CONFIG,
  allGatesClosed,
  createGame,
  nextGateIndex,
  requestCloseGate,
  secondsRemaining,
  setPump,
  startGame,
  tick,
} from "../src/game-model.mjs";

function runSafeStrategy(game) {
  for (let step = 0; step < 1800 && game.status === "running"; step += 1) {
    tick(game, 0.1);
    const gateIndex = nextGateIndex(game);
    if (
      gateIndex >= 0
      && game.gates[gateIndex].state === "open"
      && !game.gates.some((gate) => gate.state === "closing")
      && game.spawnCursor >= game.vehicles.length
    ) {
      const gate = game.gates[gateIndex];
      const routeClear = game.vehicles.every(
        (vehicle) => vehicle.status !== "active" || vehicle.x > gate.x + 40,
      );
      if (routeClear) {
        requestCloseGate(game, gateIndex);
      }
    }
  }
  return game;
}

test("闸门必须按 A → B → C → D 依次关闭，且一次只驱动一道", () => {
  const game = createGame();
  startGame(game);

  assert.equal(requestCloseGate(game, 1).ok, false);
  assert.match(requestCloseGate(game, 1).message, /顺序/);

  const started = requestCloseGate(game, 0);
  assert.equal(started.ok, true);
  assert.equal(game.gates[0].state, "closing");

  const simultaneous = requestCloseGate(game, 1);
  assert.equal(simultaneous.ok, false);
  assert.match(simultaneous.message, /一次只能/);
});

test("按撤离节奏逐闸关闭可以在三分钟内守住港区", () => {
  const game = createGame();
  startGame(game);
  runSafeStrategy(game);

  assert.equal(game.status, "won");
  assert.equal(allGatesClosed(game), true);
  assert.ok(game.water < CONFIG.warningLevel);
  assert.equal(game.safeCount, game.vehicles.length);
  assert.ok(secondsRemaining(game) > 0);
  assert.ok(game.time < 130);
});

test("车辆处于 A 闸门区时落闸会立即判定车辆被困并失败", () => {
  const game = createGame();
  startGame(game);
  tick(game, 4.2);

  assert.equal(game.status, "running");
  assert.ok(Math.abs(game.vehicles[0].x - game.gates[0].x) < 12);
  assert.equal(requestCloseGate(game, 0).ok, true);

  tick(game, 0.2);

  assert.equal(game.status, "lost");
  assert.equal(game.fail.code, "vehicle-trapped");
  assert.equal(game.fail.vehicleId, "港运-01");
  assert.equal(game.fail.gateId, "A");
  assert.equal(game.vehicles[0].status, "trapped");
  assert.match(game.fail.message, /港运-01.*A 闸/);
});

test("水泵持续排水会快速耗尽电量", () => {
  const game = createGame();
  startGame(game);
  assert.equal(setPump(game, true).ok, true);
  const startWater = game.water;
  tick(game, 20);

  assert.equal(game.pumpOn, true);
  assert.ok(game.power < 60);
  assert.ok(game.water < startWater + 0.35);
});
