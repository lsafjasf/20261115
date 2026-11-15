// Canvas renderer for bodies and live contact annotations.

const COLORS = {
  circle: '#4f9cf9',
  box: '#f5a524',
  wall: '#9aa4b2',
  ground: '#6b7280',
  contact: '#ff4d4f',
  normal: '#22c55e',
  dragged: '#f472b6',
};

export function render(ctx, world, draggedBody) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  drawGrid(ctx);

  for (const body of world.bodies) drawBody(ctx, body, body === draggedBody);

  for (const contact of world.lastContacts) drawContact(ctx, contact);
}

function drawGrid(ctx) {
  ctx.save();
  ctx.strokeStyle = 'rgba(148,163,184,0.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= ctx.canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ctx.canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= ctx.canvas.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ctx.canvas.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBody(ctx, body, dragged) {
  ctx.save();
  ctx.translate(body.pos.x, body.pos.y);
  ctx.rotate(body.angle);
  const fill = dragged ? COLORS.dragged
    : body.isStatic ? 'rgba(148,163,184,0.25)' : COLORS[body.shape.kind];

  if (body.shape.kind === 'circle') {
    ctx.beginPath();
    ctx.arc(0, 0, body.shape.radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Orientation tick.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(body.shape.radius, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.stroke();
  } else if (body.shape.kind === 'box') {
    const { halfX, halfY } = body.shape;
    ctx.fillStyle = fill;
    ctx.fillRect(-halfX, -halfY, halfX * 2, halfY * 2);
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 2;
    ctx.strokeRect(-halfX, -halfY, halfX * 2, halfY * 2);
  }
  ctx.restore();

  if (body.shape.kind === 'wall') drawWall(ctx, body);
  drawLabel(ctx, body);
}

function drawWall(ctx, body) {
  const [a, b] = body.wallPoints();
  ctx.save();
  ctx.strokeStyle = body.label === 'ground' ? COLORS.ground : COLORS.wall;
  ctx.lineWidth = body.label === 'thin-wall' ? 4 : 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  // Normal hint for inclines.
  if (body.label === 'incline') {
    const n = body.wallNormal();
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    ctx.strokeStyle = 'rgba(34,197,94,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mid.x, mid.y);
    ctx.lineTo(mid.x + n.x * 22, mid.y + n.y * 22);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLabel(ctx, body) {
  if (!body.label) return;
  ctx.save();
  ctx.font = '11px monospace';
  ctx.fillStyle = '#cbd5e1';
  ctx.textAlign = 'center';
  const y = body.shape.kind === 'wall'
    ? body.wallPoints()[0].y - 10
    : body.pos.y - body.boundingRadius() - 8;
  ctx.fillText(body.label, body.shape.kind === 'wall'
    ? (body.wallPoints()[0].x + body.wallPoints()[1].x) / 2
    : body.pos.x, y);
  ctx.restore();
}

function drawContact(ctx, contact) {
  const { point, normal, depth } = contact;
  ctx.save();
  // Contact point marker.
  ctx.fillStyle = COLORS.contact;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
  ctx.fill();
  // Normal arrow.
  const arrowLen = 26 + depth;
  const tip = { x: point.x + normal.x * arrowLen, y: point.y + normal.y * arrowLen };
  ctx.strokeStyle = COLORS.normal;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  ctx.fillStyle = COLORS.normal;
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 3, 0, Math.PI * 2);
  ctx.fill();
  // Depth badge.
  ctx.font = 'bold 11px monospace';
  ctx.fillStyle = '#fef2f2';
  ctx.fillRect(tip.x + 4, tip.y - 14, 58, 16);
  ctx.fillStyle = '#b91c1c';
  ctx.textAlign = 'left';
  ctx.fillText(`d=${depth.toFixed(2)}px`, tip.x + 7, tip.y - 2);
  ctx.restore();
}
