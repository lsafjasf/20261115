/* Headless deterministic round: runs the fixed seed and exports every dispatch. */

const fs = require("fs");
const path = require("path");
const { Rng } = require("../js/rng.js");
const { MAP } = require("../js/map.js");
const { GameEngine, ROUND_SECONDS } = require("../js/engine.js");
const { runAuto } = require("../js/autopilot.js");

const SEED = Number(process.env.SEED) || 20261115;
const OUT_DIR = path.join(__dirname, "..", "artifacts");

function toCsv(records) {
  const header = [
    "dispatchId", "time", "ambulanceId", "patientId", "patientLabel", "severity",
    "hospitalId", "priority", "status", "pickedAt", "deliveredAt", "successRate",
    "outcome", "note",
  ];
  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const text = String(value).replace(/"/g, '""');
    return /[",\n]/.test(text) ? `"${text}"` : text;
  };
  const rows = records.map((record) => header.map((key) => escape(record[key])).join(","));
  return [header.join(","), ...rows].join("\n");
}

function main() {
  const engine = new GameEngine(new Rng(SEED), MAP);
  const result = runAuto(engine, 1);
  const data = engine.exportData();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `dispatch-seed-${SEED}.json`);
  const csvPath = path.join(OUT_DIR, `dispatch-seed-${SEED}.csv`);
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  fs.writeFileSync(csvPath, `${toCsv(data.dispatchRecords)}\n`);

  console.log(`seed=${SEED} 模拟 ${ROUND_SECONDS}s 结束`);
  console.log(`结果: ${result.success ? "成功" : "失败"}（${result.reason}）`);
  console.log(`调派 ${data.dispatchRecords.length} 次，送达 ${result.delivered}/5，保留可用车=${result.usableCar}`);
  for (const record of data.dispatchRecords) {
    console.log(
      `  ${record.dispatchId} t=${record.time}s ${record.ambulanceId} -> ${record.patientId} -> ${record.hospitalId} ` +
        `${record.status} 成功率=${record.successRate ?? "-"}`,
    );
  }
  console.log(`导出: ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`导出: ${path.relative(process.cwd(), csvPath)}`);
  if (!result.success) process.exitCode = 1;
}

main();
