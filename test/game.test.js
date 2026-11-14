import assert from "node:assert/strict";
import test from "node:test";
import { IceCoreGame } from "../src/game.js";
import { SITES } from "../src/config.js";
import { createNavigation } from "../src/pathfinding.js";

const navigation = createNavigation();

function newGame() {
  const game = new IceCoreGame(navigation);
  game.start();
  return game;
}

function idle() {
  return {
    forward: false,
    reverse: false,
    left: false,
    right: false,
    rpm: false,
    pressure: false,
  };
}

test("camp has a crack-safe route to every sampling site", () => {
  assert.equal(navigation.campRoutes.length, SITES.length);
  for (let index = 0; index < SITES.length; index += 1) {
    const route = navigation.campRoutes[index];
    assert.equal(route.found, true, `${SITES[index].id} should be reachable`);
    assert.equal(
      route.violations.length,
      0,
      `${SITES[index].id} route must not cross an open lead`,
    );
    assert.ok(route.bridges.length > 0, "safe route should use a snow bridge");
    assert.ok(route.length > 0);
  }
});

test("overspeed without downforce jams the drill and releasing controls clears it", () => {
  const game = newGame();
  game.debugTeleportToSite(0);
  game.update(1 / 60, idle());
  assert.equal(game.canDrill, true);
  assert.equal(game.startDrilling(), true);

  const overspeed = { ...idle(), rpm: true };
  for (let step = 0; step < 360; step += 1) {
    game.update(1 / 60, overspeed);
    if (game.drilling.jam) break;
  }
  assert.equal(game.drilling.jam, true);
  assert.equal(game.jamCount, 1);
  assert.ok(game.drilling.rpm > 90);
  assert.ok(game.drilling.torque > 98);

  for (let step = 0; step < 220; step += 1) {
    game.update(1 / 60, idle());
    if (!game.drilling.jam) break;
  }
  assert.equal(game.drilling.jam, false);
  assert.equal(game.mode, "drilling");
});

test("balanced RPM and downforce recover one complete core", () => {
  const game = newGame();
  game.debugTeleportToSite(0);
  game.update(1 / 60, idle());
  assert.equal(game.startDrilling(), true);

  for (let step = 0; step < 1800; step += 1) {
    const drill = game.drilling;
    const safeTorque = drill.torque < 86;
    const input = {
      ...idle(),
      rpm: safeTorque && drill.rpm < 62,
      pressure: safeTorque && drill.pressure < 45,
    };
    game.update(1 / 60, input);
    if (game.activeSiteIndex === 1) break;
  }

  assert.equal(game.activeSiteIndex, 1);
  assert.equal(game.vehicle.load, 1);
  assert.equal(game.vehicle.cores.length, 1);
  assert.equal(game.sites[0].done, true);
  assert.equal(game.jamCount, 0);
  assert.equal(game.result, null);
  assert.equal(game.mode, "driving");
});

test("crossing an open lead damages a loaded vehicle more", () => {
  const light = newGame();
  light.vehicle.hull = 100;
  light.vehicle.load = 0;
  light.handleCrackCrossing(
    { crackId: "unit-test-lead", bridge: null, point: { x: 750, y: 420 } },
    1 / 60,
  );
  const lightDamage = 100 - light.vehicle.hull;

  const loaded = newGame();
  loaded.vehicle.hull = 100;
  loaded.vehicle.load = 3;
  loaded.handleCrackCrossing(
    { crackId: "unit-test-lead", bridge: null, point: { x: 750, y: 420 } },
    1 / 60,
  );
  const loadedDamage = 100 - loaded.vehicle.hull;

  assert.ok(loadedDamage > lightDamage + 30);
  assert.equal(light.crackCrossings, 1);
  assert.equal(loaded.crackCrossings, 1);
});
