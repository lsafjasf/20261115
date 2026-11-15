// Rigid bodies and shape definitions.
//
// Shape kinds:
//   circle: { kind: 'circle', radius }
//   box:    { kind: 'box', halfX, halfY } (local axes, rotated by body.angle)
//   wall:   { kind: 'wall', a, b } static zero-thickness segment, with a
//           one-sided normal pointing to its left side (a -> b rotated +90deg)

import { add, rotate, scale, sub } from './vec.js';

let nextId = 1;

export class Body {
  constructor(shape, opts = {}) {
    this.id = nextId++;
    this.shape = shape;
    this.pos = { x: opts.x ?? 0, y: opts.y ?? 0 };
    this.angle = opts.angle ?? 0;
    this.vel = { x: opts.vx ?? 0, y: opts.vy ?? 0 };
    this.angularVel = opts.angularVel ?? 0;
    this.isStatic = opts.isStatic ?? false;
    this.restitution = opts.restitution ?? 0.2;
    this.friction = opts.friction ?? 0.25;
    this.density = opts.density ?? 1;
    this.label = opts.label ?? '';
    this.userDragged = false;

    if (this.isStatic) {
      this.invMass = 0;
      this.invInertia = 0;
    } else {
      const { mass, inertia } = this.computeMassInertia();
      this.invMass = 1 / mass;
      this.invInertia = 1 / inertia;
    }
  }

  computeMassInertia() {
    const d = this.density;
    if (this.shape.kind === 'circle') {
      const r = this.shape.radius;
      const mass = d * Math.PI * r * r;
      return { mass, inertia: 0.5 * mass * r * r };
    }
    const hx = this.shape.halfX;
    const hy = this.shape.halfY;
    const mass = d * 4 * hx * hy;
    // I = m/12 * (w^2 + h^2)
    const inertia = (mass / 12) * (4 * hx * hx + 4 * hy * hy);
    return { mass, inertia };
  }

  // Bounding-circle radius measured from the body position. For walls the
  // body position is the origin and endpoints are stored locally, giving a
  // tight bound instead of the (huge) distance from world origin.
  boundingRadius() {
    if (this.shape.kind === 'circle') return this.shape.radius;
    if (this.shape.kind === 'box') {
      return Math.hypot(this.shape.halfX, this.shape.halfY);
    }
    const { a, b } = this.shape;
    return Math.max(
      Math.hypot(a.x - this.pos.x, a.y - this.pos.y),
      Math.hypot(b.x - this.pos.x, b.y - this.pos.y),
    );
  }

  // Axis-aligned bounding box { minX, minY, maxX, maxY } in world space.
  aabb() {
    if (this.shape.kind === 'circle') {
      const r = this.shape.radius;
      return {
        minX: this.pos.x - r,
        minY: this.pos.y - r,
        maxX: this.pos.x + r,
        maxY: this.pos.y + r,
      };
    }
    if (this.shape.kind === 'box') {
      const r = this.boundingRadius();
      return {
        minX: this.pos.x - r,
        minY: this.pos.y - r,
        maxX: this.pos.x + r,
        maxY: this.pos.y + r,
      };
    }
    const [pa, pb] = this.wallPoints();
    return {
      minX: Math.min(pa.x, pb.x),
      minY: Math.min(pa.y, pb.y),
      maxX: Math.max(pa.x, pb.x),
      maxY: Math.max(pa.y, pb.y),
    };
  }

  // World-space vertices for a box.
  vertices() {
    const { halfX, halfY } = this.shape;
    const local = [
      { x: -halfX, y: -halfY },
      { x: halfX, y: -halfY },
      { x: halfX, y: halfY },
      { x: -halfX, y: halfY },
    ];
    return local.map((v) => add(rotate(v, this.angle), this.pos));
  }

  // World-space endpoints for a wall.
  wallPoints() {
    const { a, b } = this.shape;
    return [add(a, this.pos), add(b, this.pos)];
  }

  wallNormal() {
    const [a, b] = this.wallPoints();
    const dir = normalizeOr(sub(b, a));
    return { x: -dir.y, y: dir.x }; // left-hand normal
  }

 advance(dt) {
    if (this.isStatic) return;
    this.pos = add(this.pos, scale(this.vel, dt));
    this.angle += this.angularVel * dt;
  }
}

function normalizeOr(v) {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-12 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
}

export const circle = (radius) => ({ kind: 'circle', radius });
export const box = (halfX, halfY) => ({ kind: 'box', halfX, halfY });

// Wall segment given in world coordinates; the body itself stays at origin.
export const wall = (a, b) => ({
  kind: 'wall',
  a: { ...a },
  b: { ...b },
});
