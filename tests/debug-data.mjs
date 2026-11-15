import { ROUTES, START_CLOCK } from "../app/js/data.js";

for (const r of ROUTES) {
  console.log(`\n=== ${r.name}  samples=${r.samples.length}  limit=${r.speedLimit}`);
  const groups = {};
  for (const a of r.anomalies) {
    (groups[a.type] ??= []).push(a);
  }
  for (const [type, list] of Object.entries(groups)) {
    console.log(type.padEnd(8), `count=${list.length}`);
    for (const a of list.slice(0, 6)) {
      const p = r.samples[a.start];
      console.log(
        "  ",
        `t=${a.start}-${a.end}`,
        `clock=${new Date((START_CLOCK + a.start) * 1000).toISOString().slice(11, 19)}`,
        `peak=${a.peak ?? "-"}`,
        a.stationName ?? "",
        `v=${p.speed}`,
      );
    }
  }
  const maxSpeed = Math.max(...r.samples.map((p) => p.speed));
  const minSpeed = Math.min(...r.samples.map((p) => p.speed));
  console.log("speed range:", minSpeed, "to", maxSpeed);
}
