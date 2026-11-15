function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function canvasBlob(canvas, type = "image/png") {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas export failed"));
    }, type);
  });
}

export async function exportTerrainPng(sourceCanvas, payload) {
  const output = document.createElement("canvas");
  output.width = sourceCanvas.width;
  output.height = sourceCanvas.height;
  const context = output.getContext("2d");
  context.drawImage(sourceCanvas, 0, 0);

  const scale = Math.max(0.8, output.width / 1920);
  const margin = Math.round(42 * scale);
  const topGradient = context.createLinearGradient(0, 0, 0, 240 * scale);
  topGradient.addColorStop(0, "rgba(3, 10, 12, 0.87)");
  topGradient.addColorStop(1, "rgba(3, 10, 12, 0)");
  context.fillStyle = topGradient;
  context.fillRect(0, 0, output.width, 240 * scale);

  const bottomGradient = context.createLinearGradient(0, output.height - 190 * scale, 0, output.height);
  bottomGradient.addColorStop(0, "rgba(3, 10, 12, 0)");
  bottomGradient.addColorStop(1, "rgba(3, 10, 12, 0.88)");
  context.fillStyle = bottomGradient;
  context.fillRect(0, output.height - 190 * scale, output.width, 190 * scale);

  context.fillStyle = "#d9f277";
  context.font = `500 ${Math.round(13 * scale)}px "Ubuntu Mono", monospace`;
  context.letterSpacing = `${Math.round(2 * scale)}px`;
  context.fillText("TERRAIN / LAB", margin, margin + 14 * scale);
  context.fillStyle = "#f0f5ee";
  context.font = `700 ${Math.round(31 * scale)}px "Noto Sans SC", sans-serif`;
  context.fillText(payload.title, margin, margin + 53 * scale);
  context.fillStyle = "rgba(193, 213, 207, 0.7)";
  context.font = `400 ${Math.round(12 * scale)}px "Ubuntu Mono", monospace`;
  context.fillText(`SEED  ${payload.params.seed}`, margin, margin + 79 * scale);
  context.fillText(
    `FREQ ${payload.params.frequency.toFixed(2)}   OCT ${payload.params.octaves}   EROSION ${Math.round(payload.params.erosion * 100)}%`,
    margin,
    margin + 99 * scale,
  );

  const baseline = output.height - margin;
  const stats = [
    ["PEAK", `${Math.round(payload.stats.peakElevation)} m`],
    ["LAND", `${payload.stats.landAreaKm2.toFixed(2)} km²`],
    ["WATER", `${Math.round(payload.stats.waterElevation)} m`],
    ["CAVES", `${payload.flags.length}`],
  ];
  const column = Math.min(220 * scale, (output.width - margin * 2) / stats.length);
  stats.forEach(([label, value], index) => {
    const x = margin + index * column;
    context.fillStyle = "rgba(138, 161, 157, 0.84)";
    context.font = `400 ${Math.round(10 * scale)}px "Ubuntu Mono", monospace`;
    context.fillText(label, x, baseline - 34 * scale);
    context.fillStyle = index === 2 ? "#74dbe1" : "#e8f0e7";
    context.font = `500 ${Math.round(18 * scale)}px "Ubuntu Mono", monospace`;
    context.fillText(value, x, baseline - 9 * scale);
  });
  context.textAlign = "right";
  context.fillStyle = "rgba(138, 161, 157, 0.72)";
  context.font = `400 ${Math.round(9 * scale)}px "Ubuntu Mono", monospace`;
  context.fillText("WORLD 1800 × 1800 M  /  HEIGHTFIELD 160²", output.width - margin, baseline - 34 * scale);
  context.fillText(payload.exportedAt, output.width - margin, baseline - 10 * scale);

  const blob = await canvasBlob(output);
  downloadBlob(blob, `terrain-${payload.params.seed}-${timestamp()}.png`);
}

export function buildExportPayload({ params, stats, flags, title = "未命名地貌" }) {
  const exportedAt = new Date().toISOString();
  return {
    format: "terrain-lab/v1",
    exportedAt,
    title,
    params,
    world: {
      extentMeters: 1800,
      heightScaleMeters: 900,
      gridSize: stats.grid,
      waterSurface: "flat",
    },
    stats,
    flags,
  };
}

export function exportTerrainJson(payload) {
  const content = JSON.stringify(payload, null, 2);
  downloadBlob(new Blob([content], { type: "application/json" }), `terrain-${payload.params.seed}-${timestamp()}.json`);
}
