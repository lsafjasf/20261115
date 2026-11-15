// Physics world: AABB broadphase, continuous collision via adaptive
// sub-pixel substeps, impulse resolution and positional correction.

import {
  add,
  clamp,
  closestPointOnSegment,
  cross,
  crossSV,
  dot,
  len,
  normalize,
  rotate,
  scale,
  sub,
} from './vec.js';
import { detectContact } from './collision.js';

const POSITION_SLOP = 1e-4;
const SOLVER_ITERATIONS = 8;
export class World {
  constructor(gravity = { x: 0, y: 900 }) {
    this.bodies = [];
    this.gravity = gravity;
    this.lastContacts = [];
    this.frameContacts = []; // every contact resolved during the last step
  }

  add(...bodiesToAdd) {
    for (const body of bodiesToAdd) this.bodies.push(body);
    return bodiesToAdd.length === 1 ? bodiesToAdd[0] : bodiesToAdd;
  }

  pairs() {
    const out = [];
    for (let i = 0; i < this.bodies.length; i++) {
      for (let j = i + 1; j < this.bodies.length; j++) {
        const a = this.bodies[i];
        const b = this.bodies[j];
        if (a.isStatic && b.isStatic) continue;
        // Broadphase: overlapping AABBs (inflated by 1 px margin).
        const ba = a.aabb();
        const bb = b.aabb();
        if (
          ba.maxX + 1 < bb.minX ||
          bb.maxX + 1 < ba.minX ||
          ba.maxY + 1 < bb.minY ||
          bb.maxY + 1 < ba.minY
        ) {
          continue;
        }
        out.push([a, b]);
      }
    }
    return out;
  }

  // Exact signed separation for a pair (> 0 apart, < 0 overlapping).
  pairGap(a, b) {
    const contact = detectContact(a, b);
    if (contact) return contact.gap;
    const ka = a.shape.kind;
    const kb = b.shape.kind;
    if (ka === 'circle' && kb === 'circle') {
      return len(sub(b.pos, a.pos)) - a.shape.radius - b.shape.radius;
    }
    if (ka === 'circle' && kb === 'box') return this.circleBoxGap(a, b);
    if (ka === 'box' && kb === 'circle') return this.circleBoxGap(b, a);
    if (ka === 'circle' && kb === 'wall') return this.circleWallGap(a, b);
    if (ka === 'wall' && kb === 'circle') return this.circleWallGap(b, a);
    if (ka === 'box' && kb === 'wall') return this.boxWallGap(a, b);
    if (ka === 'wall' && kb === 'box') return this.boxWallGap(b, a);
    if (ka === 'box' && kb === 'box') return this.boxBoxGap(a, b);
    return Infinity;
  }

  circleBoxGap(c, bx) {
    const local = rotate(sub(c.pos, bx.pos), -bx.angle);
    const q = {
      x: clamp(local.x, -bx.shape.halfX, bx.shape.halfX),
      y: clamp(local.y, -bx.shape.halfY, bx.shape.halfY),
    };
    return len(sub(local, q)) - c.shape.radius;
  }

  circleWallGap(c, w) {
    const [wa, wb] = w.wallPoints();
    const q = closestPointOnSegment(c.pos, wa, wb);
    return len(sub(c.pos, q)) - c.shape.radius;
  }

  boxBoxGap(a, b) {
    const axes = [
      rotate({ x: 1, y: 0 }, a.angle),
      rotate({ x: 0, y: 1 }, a.angle),
      rotate({ x: 1, y: 0 }, b.angle),
      rotate({ x: 0, y: 1 }, b.angle),
    ];
    let minSep = Infinity;
    for (const axis of axes) {
      const pa = a.vertices().map((v) => dot(v, axis));
      const pb = b.vertices().map((v) => dot(v, axis));
      const sep = Math.min(...pb) - Math.max(...pa);
      const sep2 = Math.min(...pa) - Math.max(...pb);
      minSep = Math.min(minSep, Math.max(sep, sep2));
    }
    return minSep;
  }

  boxWallGap(bx, w) {
    const contact = detectContact(bx, w);
    if (contact) return contact.gap;
    const [wa, wb] = w.wallPoints();
    const dir = normalize(sub(wb, wa));
    const n = { x: -dir.y, y: dir.x };
    const length = len(sub(wb, wa));
    let minGap = Infinity;
    // Separated: smallest unsigned distance of any vertex to the segment.
    for (const v of bx.vertices()) {
      const along = dot(sub(v, wa), dir);
      if (along < 0 || along > length) continue;
      minGap = Math.min(minGap, Math.abs(dot(sub(v, wa), n)));
    }
    for (const e of [wa, wb]) {
      const local = rotate(sub(e, bx.pos), -bx.angle);
      const q = {
        x: clamp(local.x, -bx.shape.halfX, bx.shape.halfX),
        y: clamp(local.y, -bx.shape.halfY, bx.shape.halfY),
      };
      minGap = Math.min(minGap, len(sub(local, q)));
    }
    return minGap;
  }

  // Conservative upper bound on the relative contact-point speed. Safe by
  // construction: the real closing speed can never exceed this value, so the
  // time of impact computed from it can never skip through a thin wall.
  speedBound(a, b) {
    const rel = sub(b.vel, a.vel);
    return (
      len(rel) +
      Math.abs(a.angularVel) * a.boundingRadius() +
      Math.abs(b.angularVel) * b.boundingRadius()
    );
  }

  step(dt) {
    this.frameContacts = [];
    // Gravity integration (impulse style, velocity first).
    for (const body of this.bodies) {
      if (body.isStatic || body.userDragged) continue;
      body.vel = add(body.vel, scale(this.gravity, dt));
    }

    // Fixed small substeps. Travel per substep is bounded to a fraction of a
    // pixel for every body, so no movement can tunnel through a zero-thickness
    // wall or skip a contact; the solver runs before and after each substep.
    const sub = this.chooseSubstep(dt);
    const count = Math.max(1, Math.ceil(dt / sub));
    const h = dt / count;
    for (let k = 0; k < count; k++) {
      this.solveContacts();
      for (const body of this.bodies) body.advance(h);
      this.solveContacts();
    }

    this.collectContacts();
    // Merge contacts resolved during substeps (including transient impacts
    // that have already separated by frame end), keyed by body pair.
    const seen = new Set(this.lastContacts.map((c) => `${c.a.id}-${c.b.id}`));
    for (const c of this.frameContacts) {
      const key = `${c.a.id}-${c.b.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        this.lastContacts.push(c);
      }
    }
  }

  // Largest substep that keeps every body's travel below its own radius.
  chooseSubstep(dt) {
    let substep = dt;
    for (const body of this.bodies) {
      if (body.isStatic) continue;
      // Include rotational contact-point speed, matching speedBound().
      const speed = len(body.vel) +
        Math.abs(body.angularVel) * body.boundingRadius();
      if (speed <= 1e-6) continue;
      const feature = body.shape.kind === 'circle'
        ? body.shape.radius
        : Math.min(body.shape.halfX, body.shape.halfY);
      // Each body travels at most ~0.05 px per substep. This is deliberately
      // far smaller than any contact gap so a center can never cross into a
      // box interior or through a zero-thickness wall between two substeps.
      const limit = Math.min((feature * 0.02) / speed, 0.05 / speed);
      if (limit < substep) substep = limit;
    }
    return Math.max(1e-6, Math.min(dt, substep));
  }

  solveContacts() {
    for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
      const contacts = [];
      for (const [a, b] of this.pairs()) {
        const contact = detectContact(a, b);
        if (contact && contact.depth > 0) contacts.push(contact);
      }
      if (contacts.length === 0) break;
      if (iter === 0) this.frameContacts.push(...contacts.map((c) => ({ ...c })));
      for (const contact of contacts) this.resolveImpulse(contact);
      for (const contact of contacts) this.correctPosition(contact);
    }
  }

  invMassOf(body) {
    return body.userDragged ? 0 : body.invMass;
  }

  invInertiaOf(body) {
    return body.userDragged ? 0 : body.invInertia;
  }

  resolveImpulse(contact) {
    const { a, b, point, normal } = contact;
    const ra = sub(point, a.pos);
    const rb = sub(point, b.pos);
    const va = add(a.vel, crossSV(a.angularVel, ra));
    const vb = add(b.vel, crossSV(b.angularVel, rb));
    const relVel = sub(vb, va);
    const velAlongNormal = dot(relVel, normal);
    const deeplyEmbedded = contact.depth > 1;
    // Shallow contacts follow the standard rule: ignore pairs already
    // separating along the normal. Deeply embedded pairs (a circle center
    // trapped in a box) get an unconditional separating impulse.
    if (velAlongNormal > 0 && !deeplyEmbedded) return;

    const raCrossN = cross(ra, normal);
    const rbCrossN = cross(rb, normal);
    const invMassSum =
      this.invMassOf(a) +
      this.invMassOf(b) +
      this.invInertiaOf(a) * raCrossN * raCrossN +
      this.invInertiaOf(b) * rbCrossN * rbCrossN;
    if (invMassSum <= 1e-12) return;

    const e = Math.min(a.restitution, b.restitution);
    const j = -(1 + e) * velAlongNormal / invMassSum;
    const impulse = scale(normal, j);
    this.applyImpulse(a, scale(impulse, -1), ra);
    this.applyImpulse(b, impulse, rb);

    // Friction impulse along the contact tangent.
    const tangent = normalize(sub(relVel, scale(normal, dot(relVel, normal))));
    if (len(tangent) < 1e-9) return;
    const raCrossT = cross(ra, tangent);
    const rbCrossT = cross(rb, tangent);
    const invTangentMass =
      this.invMassOf(a) +
      this.invMassOf(b) +
      this.invInertiaOf(a) * raCrossT * raCrossT +
      this.invInertiaOf(b) * rbCrossT * rbCrossT;
    let jt = -dot(relVel, tangent) / invTangentMass;
    const mu = Math.sqrt(a.friction * b.friction);
    jt = clamp(jt, -mu * Math.abs(j), mu * Math.abs(j));
    const frictionImpulse = scale(tangent, jt);
    this.applyImpulse(a, scale(frictionImpulse, -1), ra);
    this.applyImpulse(b, frictionImpulse, rb);
  }

  applyImpulse(body, impulse, r) {
    if (body.isStatic || body.userDragged) return;
    body.vel = add(body.vel, scale(impulse, body.invMass));
    body.angularVel += cross(r, impulse) * body.invInertia;
  }

  correctPosition(contact) {
    const { a, b, normal, depth } = contact;
    const correction = Math.max(depth - POSITION_SLOP, 0);
    if (correction <= 0) return;

    // Static wall: move only the dynamic body. For a box straddling a
    // zero-thickness wall, translate it just enough to bring the shallowest
    // crossing vertex back onto the wall line, which never over-pushes the
    // other vertices.
    if (a.isStatic || b.isStatic) {
      const dynamic = a.isStatic ? b : a;
      // Normal points a -> b. If the dynamic body is b, it must move along
      // the normal to separate; if it is a, against the normal.
      const sign = dynamic === b ? 1 : -1;
      if (this.invMassOf(dynamic) > 0) {
        dynamic.pos = add(dynamic.pos, scale(normal, sign * correction));
      }
      return;
    }

    // Two dynamic bodies: split the correction by inverse mass.
    const invA = this.invMassOf(a);
    const invB = this.invMassOf(b);
    const sum = invA + invB;
    if (sum <= 1e-12) return;
    if (invA > 0) a.pos = sub(a.pos, scale(normal, (correction * invA) / sum));
    if (invB > 0) b.pos = add(b.pos, scale(normal, (correction * invB) / sum));
  }

  collectContacts() {
    this.lastContacts = [];
    for (const [a, b] of this.pairs()) {
      const contact = detectContact(a, b);
      if (contact && contact.depth >= 0) this.lastContacts.push(contact);
    }
    return this.lastContacts;
  }
}
