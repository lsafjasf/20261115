(function () {
  "use strict";

  const START_UTC = Date.UTC(2026, 10, 13, 4, 0, 0);
  const SLOT_COUNT = 37;
  const STEP_MS = 60 * 60 * 1000;

  const STATIONS = [
    { name: "东港", base: 2.34, amplitude: 0.48, phase: 6.5, secondary: 0.08, color: "#087c73", nulls: [22, 23], invalid: [] },
    { name: "西沙", base: 2.41, amplitude: 0.31, phase: 2.0, secondary: 0.05, color: "#477fa2", nulls: [29, 30, 31], invalid: [] },
    { name: "南屿", base: 2.29, amplitude: 0.46, phase: 9.2, secondary: 0.07, color: "#9a783e", nulls: [17], invalid: [10] },
  ];

  const DUPLICATES = [
    { station: "东港", index: 21, offset: 0.11 },
    { station: "西沙", index: 25, offset: -0.09 },
    { station: "南屿", index: 32, offset: 0.06 },
  ];

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function slotTime(index) {
    const local = new Date(START_UTC + index * STEP_MS + 8 * STEP_MS);
    return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:00:00+08:00`;
  }

  function rawLevel(station, index) {
    const phase = station.phase;
    const primary = station.amplitude * Math.sin((2 * Math.PI * (index + phase)) / 12.42);
    const secondary = station.secondary * Math.sin((2 * Math.PI * (index + phase)) / 5.7);
    return (station.base + primary + secondary).toFixed(2);
  }

  function valueFor(station, index) {
    if (station.nulls.includes(index)) return "";
    if (station.invalid.includes(index)) return "N/A";
    return rawLevel(station, index);
  }

  function buildCsv() {
    const rows = ["station,timestamp,water_level"];
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      for (const station of STATIONS) {
        rows.push(`${station.name},${slotTime(index)},${valueFor(station, index)}`);
        const duplicate = DUPLICATES.find(
          (item) => item.station === station.name && item.index === index,
        );
        if (duplicate) {
          const original = Number(rawLevel(station, index));
          rows.push(`${station.name},${slotTime(index)},${(original + duplicate.offset).toFixed(2)}`);
        }
      }
    }
    return rows.join("\n");
  }

  window.TIDE_SAMPLE = {
    csv: buildCsv(),
    stations: STATIONS.map(({ name, color }) => ({ name, color })),
    startTime: slotTime(0),
    endTime: slotTime(SLOT_COUNT - 1),
    expectedStepMs: STEP_MS,
    sourceRows: SLOT_COUNT * STATIONS.length + DUPLICATES.length,
  };
})();
