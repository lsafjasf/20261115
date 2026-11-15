/* Canvas renderer for roads, districts, casualties, hospitals and ambulances. */

const SEVERITY_STYLE = {
  critical: { color: "#ef4444", text: "危重" },
  serious: { color: "#f59e0b", text: "重伤" },
  moderate: { color: "#38bdf8", text: "轻症" },
};

function drawScene(ctx, engine, hover = {}) {
  const { map } = engine;
  ctx.clearRect(0, 0, map.width, map.height);
  drawDistricts(ctx, map);
  drawRoads(ctx, engine);
  drawRoutePreview(ctx, engine, hover);
  drawDepot(ctx, map);
  for (const hospital of engine.hospitals) drawHospital(ctx, engine, hospital);
  for (const patient of engine.patients) drawPatient(ctx, engine, patient, hover);
  for (const ambulance of engine.ambulances) drawAmbulance(ctx, engine, ambulance, hover);
}

function drawDistricts(ctx, map) {
  for (const district of map.districts) {
    const point = map.nodeXY(district.node);
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = district.color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawRoads(ctx, engine) {
  const { map } = engine;
  for (const edge of map.edges) {
    const a = map.nodeXY(edge.a);
    const b = map.nodeXY(edge.b);
    const factor = engine.trafficFactor[edgeKeyLocal(edge.a, edge.b)] ?? 1;
    const level = trafficColor(factor);
    ctx.lineCap = "round";
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 13;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = level;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.fillStyle = "#cbd5e1";
  for (let id = 0; id < map.nodeCount; id += 1) {
    const point = map.nodeXY(id);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function trafficColor(factor) {
  if (factor <= 0.9) return "#22c55e";
  if (factor <= 1.05) return "#a3e635";
  if (factor <= 1.7) return "#f59e0b";
  return "#ef4444";
}

function drawRoutePreview(ctx, engine, hover) {
  if (!hover.ambulanceId || !hover.patientId) return;
  const ambulance = engine.ambulanceById(hover.ambulanceId);
  const patient = engine.patientById(hover.patientId);
  if (!ambulance || !patient || ambulance.mode !== "idle" || patient.state !== "waiting") return;
  const graph = engine.graph;
  const path = shortestPath(engine.map, graph, ambulance.node, patient.node);
  ctx.save();
  ctx.setLineDash([8, 7]);
  ctx.strokeStyle = "#f0abfc";
  ctx.lineWidth = 3;
  ctx.beginPath();
  path.forEach((node, index) => {
    const point = engine.map.nodeXY(node);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawDepot(ctx, map) {
  const point = map.nodeXY(map.depot.node);
  ctx.fillStyle = "#1d4ed8";
  ctx.fillRect(point.x - 16, point.y - 16, 32, 32);
  ctx.strokeStyle = "#bfdbfe";
  ctx.lineWidth = 2;
  ctx.strokeRect(point.x - 16, point.y - 16, 32, 32);
  label(ctx, "车库", point.x, point.y - 23, "#93c5fd");
}

function drawHospital(ctx, engine, hospital) {
  const point = engine.map.nodeXY(hospital.node);
  ctx.fillStyle = hospital.beds > 0 ? "#0f766e" : "#7f1d1d";
  ctx.fillRect(point.x - 15, point.y - 15, 30, 30);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(point.x - 3, point.y - 9, 6, 18);
  ctx.fillRect(point.x - 9, point.y - 3, 18, 6);
  label(ctx, `${hospital.name} 床${hospital.beds}`, point.x, point.y - 22, hospital.beds > 0 ? "#5eead4" : "#fca5a5");
  if (hospital.waiting > 0) label(ctx, `等候${hospital.waiting}`, point.x, point.y + 27, "#fde68a");
}

function drawPatient(ctx, engine, patient, hover) {
  if (patient.state === "delivered") return;
  const point = engine.map.nodeXY(patient.node);
  const style = SEVERITY_STYLE[patient.severity];
  const selected = hover.patientId === patient.id;
  ctx.save();
  ctx.fillStyle = style.color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, selected ? 13 : 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = patient.assignedTo ? "#64748b" : "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(patient.id, point.x, point.y + 4);
  ctx.restore();
  label(ctx, `${patient.label} ${Math.round(patient.successRate * 100)}%`, point.x, point.y + 24, style.color);
  if (patient.assignedTo) label(ctx, `已派 ${patient.assignedTo}`, point.x, point.y - 14, "#94a3b8");
}

function drawAmbulance(ctx, engine, ambulance, hover) {
  if (ambulance.mode === "maintenance") {
    const point = engine.map.nodeXY(ambulance.node);
    label(ctx, `${ambulance.id} 维修${Math.ceil(ambulance.repairRemaining)}s`, point.x + 18, point.y - 8, "#fca5a5");
    return;
  }
  const selected = hover.ambulanceId === ambulance.id;
  ctx.save();
  ctx.translate(ambulance.x, ambulance.y);
  ctx.fillStyle = ambulance.mode === "stranded" ? "#525252" : selected ? "#fde047" : "#f8fafc";
  ctx.strokeStyle = ambulance.usable ? "#0f172a" : "#ef4444";
  ctx.lineWidth = selected ? 3 : 2;
  roundedRect(ctx, -13, -8, 26, 16, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#dc2626";
  ctx.fillRect(-9, -5, 6, 4);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(ambulance.id, 4, 5);
  ctx.restore();
  label(ctx, `${ambulance.id} 油${Math.round(ambulance.fuel)}`, ambulance.x, ambulance.y - 15, "#e2e8f0");
  if (ambulance.mode === "queued") label(ctx, "等床", ambulance.x, ambulance.y + 18, "#fde68a");
}

function label(ctx, text, x, y, color) {
  ctx.save();
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(15,23,42,0.75)";
  const width = ctx.measureText(text).width + 8;
  ctx.fillRect(x - width / 2, y - 11, width, 15);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function edgeKeyLocal(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

if (typeof globalThis !== "undefined") {
  globalThis.__RENDER__ = { drawScene, SEVERITY_STYLE };
}
