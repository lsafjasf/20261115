const fs = require("fs");
const path = require("path");
const data = require("../src/data.js");
const planner = require("../src/planner.js");

const outputPath = path.join(__dirname, "..", "artifacts", "mission-log.json");
const log = planner.buildMissionLog(data.DEFAULT_SEQUENCE, {
  completedAt: "2026-11-15T01:18:42.000Z",
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(log, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      output: outputPath,
      verdict: log.result.verdict,
      success: log.mission.success,
      order: log.taskOrder.map((task) => task.id),
      accidents: log.pressure.accidents,
      interlocks: `${log.pressure.interlockPassed}/${log.pressure.interlockChecks}`,
      events: log.events.length,
    },
    null,
    2,
  ),
);
