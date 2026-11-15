/* Deterministic greedy auto-dispatcher used for headless seeded runs. */

const AmbulanceMap =
  typeof globalThis !== "undefined" && globalThis.__AMBULANCE_MAP__
    ? globalThis.__AMBULANCE_MAP__
    : typeof require === "function"
      ? require("./map.js")
      : null;
const { shortestPath } = AmbulanceMap;

function estimateTravelSeconds(engine, fromNode, toNode, graph) {
  const path = shortestPath(engine.map, graph, fromNode, toNode);
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i] < path[i + 1] ? `${path[i]}-${path[i + 1]}` : `${path[i + 1]}-${path[i]}`;
    const factor = engine.trafficFactor[key] ?? 1;
    const edge = engine.map.edges.find((item) => {
      const edgeKeyLocal = item.a < item.b ? `${item.a}-${item.b}` : `${item.b}-${item.a}`;
      return edgeKeyLocal === key;
    });
    if (edge) total += (edge.length * factor) / 62;
  }
  return total;
}

function urgencyScore(engine, patient) {
  const elapsed = engine.time;
  const late = Math.max(0, elapsed - patient.golden);
  return late * patient.decay + (patient.severity === "critical" ? 4 : patient.severity === "serious" ? 2 : 0);
}

function autoStep(engine) {
  const graph = engine.graph;
  const waitingPatients = engine.patients
    .filter((patient) => patient.state === "waiting" && !patient.assignedTo)
    .sort((a, b) => urgencyScore(engine, b) - urgencyScore(engine, a));

  for (const patient of waitingPatients) {
    const idleAmbulances = engine.ambulances.filter(
      (ambulance) => ambulance.mode === "idle" && ambulance.status === "ready",
    );
    const candidates = idleAmbulances
      .filter((ambulance) => ambulance.crew >= patient.crewNeed)
      .map((ambulance) => {
        const hospital = engine._autoHospital();
        const fuelNeeded = engine._estimateFuelNeeded(ambulance, patient, hospital);
        const travel = estimateTravelSeconds(engine, ambulance.node, patient.node, graph);
        return { ambulance, fuelNeeded, travel };
      })
      .filter((item) => {
        const minimum = item.ambulance.node === engine.map.depot.node ? 70 : 45;
        return item.ambulance.fuel >= Math.max(minimum, item.fuelNeeded);
      })
      .sort((a, b) => a.travel - b.travel);

    if (candidates.length === 0) continue;
    const chosen = candidates[0];
    const priority = patient.severity === "critical" ? "fastest" : "fastest";
    const result = engine.dispatch(chosen.ambulance.id, patient.id, null, priority);
    if (!result.ok && !/不能重复|不可派遣/.test(result.error)) {
      engine.logs.push({ seq: engine.logs.length + 1, time: engine.time, type: "AUTO", title: "调派跳过", detail: result.error });
    }
  }

}

function runAuto(engine, stepSeconds = 1) {
  let autoClock = 0;
  while (!engine.finished) {
    engine.update(stepSeconds);
    autoClock += stepSeconds;
    if (autoClock >= 2) {
      autoClock = 0;
      autoStep(engine);
    }
  }
  return engine.result;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { autoStep, runAuto, estimateTravelSeconds };
} else if (typeof globalThis !== "undefined") {
  globalThis.__AUTOPILOT__ = { autoStep, runAuto, estimateTravelSeconds };
}
