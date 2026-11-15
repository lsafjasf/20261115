"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Engine = require("../engine.js");

function freshTrains() {
  return Engine.cloneDefaultTrains();
}

test("initial six-train timetable is conflict free", function () {
  const result = Engine.calculate(freshTrains());

  assert.equal(result.stats.plannedTrains, 6);
  assert.equal(result.stats.severeCount, 0);
  assert.equal(result.stats.warningCount, 0);
  assert.equal(result.stats.ready, true);
  assert.equal(result.stats.sectionMinutes, 48);
  assert.equal(result.stats.trackMinutes, 96);
  assert.equal(result.stats.switchMinutes, 24);
  assert.ok(Math.abs(result.stats.sectionUtil - 43.6363) < 0.01);
  assert.equal(result.occupancies.length, 30);
});

test("deleting a train updates occupancy and capacity from one recalculation", function () {
  const trains = freshTrains();
  const removed = trains.splice(0, 1)[0];
  const result = Engine.calculate(trains);

  assert.equal(removed.number, "G101");
  assert.equal(result.stats.plannedTrains, 5);
  assert.equal(result.stats.ready, true);
  assert.equal(result.stats.sectionMinutes, 40);
  assert.equal(result.stats.trackMinutes, 80);
  assert.equal(result.stats.switchMinutes, 20);
  assert.ok(Math.abs(result.stats.sectionUtil - 36.3636) < 0.01);
  assert.equal(result.occupancies.length, 25);
  assert.equal(result.occupancies.filter(function (item) { return item.kind === "section"; }).length, 10);
});

test("overlapping single-line occupancy is severe and blocks export", function () {
  const trains = freshTrains();
  trains[1].arrival = "08:01";
  const result = Engine.calculate(trains);

  assert.ok(result.stats.severeCount > 0);
  assert.equal(result.stats.ready, false);
  assert.ok(result.conflicts.some(function (item) {
    return item.severity === "severe" && item.kind === "tracking";
  }));
  assert.ok(result.conflicts.every(function (item) {
    return item.code && item.displayTime;
  }));
});

test("same-track overlap is reported at the conflicting station track", function () {
  const trains = freshTrains();
  trains[1].track = "1";
  trains[1].arrival = "08:10";
  trains[1].departure = "08:30";
  const result = Engine.calculate(trains);

  assert.ok(result.conflicts.some(function (item) {
    return item.kind === "track" && item.title === "1道占用重叠";
  }));
});

test("short turnaround is severe while tight turnaround is only a warning", function () {
  const shortTrains = freshTrains();
  shortTrains[0].departure = "08:10";
  const shortResult = Engine.calculate(shortTrains);
  assert.equal(shortResult.stats.ready, false);
  assert.ok(shortResult.conflicts.some(function (item) {
    return item.kind === "turnaround" && item.severity === "severe";
  }));

  const tightTrains = freshTrains();
  tightTrains[0].departure = "08:13";
  const tightResult = Engine.calculate([tightTrains[0]]);
  assert.equal(tightResult.stats.severeCount, 0);
  assert.ok(tightResult.conflicts.some(function (item) {
    return item.kind === "turnaround" && item.severity === "warning";
  }));
  assert.equal(tightResult.stats.ready, true);
});

test("CSV export contains timetable and synchronized capacity summary", function () {
  const csv = Engine.buildCSV(Engine.calculate(freshTrains()));

  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /G101/);
  assert.match(csv, /K706/);
  assert.match(csv, /图定列车,6 列/);
  assert.match(csv, /单线利用率,43\.6%/);
  assert.match(csv, /到发线占用,96 min/);
});
