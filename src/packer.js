import { findTrimBounds } from "./raster.js";

const positive = (value, fallback) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;

function intersects(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function contains(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

function union(a, b) {
  if (!a) return { ...b };
  if (!b) return { ...a };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function validateFrame(frame) {
  if (!frame || typeof frame.id !== "string" || !frame.id) {
    throw new Error("Frame requires a non-empty string id.");
  }
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height)) {
    throw new Error(`Frame ${frame.id} requires integer dimensions.`);
  }
  if (frame.width < 1 || frame.height < 1) {
    throw new Error(`Frame ${frame.id} has invalid dimensions.`);
  }
  if (!frame.pixels || frame.pixels.length !== frame.width * frame.height * 4) {
    throw new Error(`Frame ${frame.id} has invalid RGBA pixel data.`);
  }
}

export class IncrementalPacker {
  constructor(options = {}) {
    this.padding = Math.max(0, Math.floor(options.padding ?? 2));
    this.rotation = options.rotation !== false;
    this.maxSize = positive(options.maxSize, 4096);
    this.growthAlign = Math.max(1, Math.floor(options.growthAlign ?? 16));
    this.initialWidth = positive(options.initialWidth, 256);
    this.initialHeight = positive(options.initialHeight, 256);
    this.width = this.initialWidth;
    this.height = this.initialHeight;
    this.items = new Map();
    this.freeRects = [{ x: 0, y: 0, w: this.width, h: this.height }];
    this.repackCount = 0;
    this.fullRepackCount = 0;
    this.contentUpdateCount = 0;
    this.deleteCount = 0;
    this.growthEvents = [];
    this.lastAffected = null;
    this.operationCount = 0;
  }

  _align(value) {
    return Math.ceil(value / this.growthAlign) * this.growthAlign;
  }

  _planForOrientation(trimWidth, trimHeight, rotated) {
    const packedWidth = (rotated ? trimHeight : trimWidth) + this.padding * 2;
    const packedHeight = (rotated ? trimWidth : trimHeight) + this.padding * 2;
    const plans = [];
    const { width, height } = this;

    if (packedHeight <= height) {
      const newWidth = this._align(width + packedWidth);
      if (newWidth <= this.maxSize) {
        plans.push({ newWidth, newHeight: height, rotated });
      }
    }
    if (packedWidth <= width) {
      const newHeight = this._align(height + packedHeight);
      if (newHeight <= this.maxSize) {
        plans.push({ newWidth: width, newHeight, rotated });
      }
    }

    const newWidth = this._align(Math.max(width, packedWidth));
    const newHeight = this._align(height + packedHeight);
    if (newWidth <= this.maxSize && newHeight <= this.maxSize) {
      plans.push({ newWidth, newHeight, rotated });
    }
    return plans;
  }

  _planExpansion(trimWidth, trimHeight) {
    const orientations = this.rotation
      ? [false, true]
      : [false];
    const plans = orientations.flatMap((rotated) =>
      this._planForOrientation(trimWidth, trimHeight, rotated),
    );
    if (!plans.length) {
      throw new Error(
        `Frame cannot fit within the ${this.maxSize}px atlas limit.`,
      );
    }
    plans.sort(
      (a, b) =>
        a.newWidth * a.newHeight - b.newWidth * b.newHeight ||
        a.newWidth + a.newHeight - (b.newWidth + b.newHeight),
    );
    return plans[0];
  }

  _grow(trimWidth, trimHeight, frameId) {
    const plan = this._planExpansion(trimWidth, trimHeight);
    const oldWidth = this.width;
    const oldHeight = this.height;
    this.width = plan.newWidth;
    this.height = plan.newHeight;

    if (this.width > oldWidth) {
      this.freeRects.push({
        x: oldWidth,
        y: 0,
        w: this.width - oldWidth,
        h: oldHeight,
      });
    }
    if (this.height > oldHeight) {
      this.freeRects.push({
        x: 0,
        y: oldHeight,
        w: this.width,
        h: this.height - oldHeight,
      });
    }
    this.freeRects = this._pruneFreeRects(this.freeRects);
    this.growthEvents.push({
      frameId,
      oldWidth,
      oldHeight,
      newWidth: this.width,
      newHeight: this.height,
    });
  }

  _findPlacement(trimWidth, trimHeight) {
    let best = null;
    const orientations = this.rotation ? [false, true] : [false];

    for (const rotated of orientations) {
      const innerWidth = rotated ? trimHeight : trimWidth;
      const innerHeight = rotated ? trimWidth : trimHeight;
      const packedWidth = innerWidth + this.padding * 2;
      const packedHeight = innerHeight + this.padding * 2;

      for (const free of this.freeRects) {
        if (packedWidth > free.w || packedHeight > free.h) continue;
        const spareX = free.w - packedWidth;
        const spareY = free.h - packedHeight;
        const score = [
          Math.min(spareX, spareY),
          Math.max(spareX, spareY),
          spareX * spareY,
          free.y,
          free.x,
          rotated ? 1 : 0,
        ];
        if (!best || this._scoreLess(score, best.score)) {
          best = {
            score,
            rotated,
            free,
            innerWidth,
            innerHeight,
            packedWidth,
            packedHeight,
          };
        }
      }
    }
    return best;
  }

  _scoreLess(a, b) {
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return a[index] < b[index];
    }
    return false;
  }

  _pruneFreeRects(rects) {
    const unique = [];
    const seen = new Set();
    for (const rect of rects) {
      if (rect.w <= 0 || rect.h <= 0) continue;
      const key = `${rect.x}:${rect.y}:${rect.w}:${rect.h}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(rect);
    }
    return unique.filter(
      (rect, index) =>
        !unique.some(
          (other, otherIndex) =>
            index !== otherIndex &&
            contains(other, rect) &&
            (other.w > rect.w || other.h > rect.h),
        ),
    );
  }

  _splitFreeRects(reservation) {
    const next = [];
    for (const free of this.freeRects) {
      if (!intersects(free, reservation)) {
        next.push(free);
        continue;
      }
      if (reservation.x > free.x) {
        next.push({
          x: free.x,
          y: free.y,
          w: reservation.x - free.x,
          h: free.h,
        });
      }
      if (reservation.x + reservation.w < free.x + free.w) {
        next.push({
          x: reservation.x + reservation.w,
          y: free.y,
          w: free.x + free.w - (reservation.x + reservation.w),
          h: free.h,
        });
      }
      if (reservation.y > free.y) {
        next.push({
          x: free.x,
          y: free.y,
          w: free.w,
          h: reservation.y - free.y,
        });
      }
      if (reservation.y + reservation.h < free.y + free.h) {
        next.push({
          x: free.x,
          y: reservation.y + reservation.h,
          w: free.w,
          h: free.y + free.h - (reservation.y + reservation.h),
        });
      }
    }
    this.freeRects = this._pruneFreeRects(next);
  }

  _makeItem(frame) {
    validateFrame(frame);
    const trim = frame.trim
      ? { ...frame.trim }
      : findTrimBounds(frame.pixels, frame.width, frame.height);
    if (!trim || trim.w < 1 || trim.h < 1) {
      throw new Error(`Frame ${frame.id} has no opaque pixels to pack.`);
    }
    return {
      id: frame.id,
      name: frame.name || frame.id,
      frame,
      sourceWidth: frame.width,
      sourceHeight: frame.height,
      trim,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      rotated: false,
      reserved: { x: 0, y: 0, w: 0, h: 0 },
    };
  }

  _placeItem(item, placement) {
    const { free, packedWidth, packedHeight, innerWidth, innerHeight } =
      placement;
    item.reserved = {
      x: free.x,
      y: free.y,
      w: packedWidth,
      h: packedHeight,
    };
    item.x = free.x + this.padding;
    item.y = free.y + this.padding;
    item.w = innerWidth;
    item.h = innerHeight;
    item.rotated = placement.rotated;
    this._splitFreeRects(item.reserved);
    this.items.set(item.id, item);
    this.repackCount += 1;
    this.operationCount += 1;
    this.lastAffected = { ...item.reserved };
    return item;
  }

  addFrame(frame) {
    if (this.items.has(frame.id)) {
      throw new Error(`Frame ${frame.id} already exists.`);
    }
    const item = this._makeItem(frame);
    let placement = this._findPlacement(item.trim.w, item.trim.h);
    const oldDimensions = { width: this.width, height: this.height };
    if (!placement) {
      this._grow(item.trim.w, item.trim.h, item.id);
      placement = this._findPlacement(item.trim.w, item.trim.h);
    }
    if (!placement) {
      throw new Error(`No placement found for frame ${frame.id}.`);
    }
    this._placeItem(item, placement);
    return {
      item,
      affected: { ...item.reserved },
      expanded:
        oldDimensions.width !== this.width ||
        oldDimensions.height !== this.height,
    };
  }

  _freeReservation(item) {
    this.items.delete(item.id);
    this.freeRects.push({ ...item.reserved });
    this.freeRects = this._pruneFreeRects(this.freeRects);
  }

  removeFrame(id) {
    const item = this.items.get(id);
    if (!item) throw new Error(`Frame ${id} does not exist.`);
    const affected = { ...item.reserved };
    this._freeReservation(item);
    this.deleteCount += 1;
    this.operationCount += 1;
    this.lastAffected = affected;
    return { item, affected };
  }

  _fitAtCurrentPosition(item, trim) {
    const orientations = this.rotation
      ? [item.rotated, !item.rotated]
      : [item.rotated];
    for (const rotated of [...new Set(orientations)]) {
      const innerWidth = rotated ? trim.h : trim.w;
      const innerHeight = rotated ? trim.w : trim.h;
      if (innerWidth <= item.w && innerHeight <= item.h) {
        item.rotated = rotated;
        item.w = innerWidth;
        item.h = innerHeight;
        return true;
      }
    }
    return false;
  }

  modifyFrame(frame) {
    const previous = this.items.get(frame.id);
    if (!previous) throw new Error(`Frame ${frame.id} does not exist.`);
    validateFrame(frame);
    const trim = frame.trim
      ? { ...frame.trim }
      : findTrimBounds(frame.pixels, frame.width, frame.height);
    if (!trim || trim.w < 1 || trim.h < 1) {
      throw new Error(`Frame ${frame.id} has no opaque pixels to pack.`);
    }

    const affectedBefore = { ...previous.reserved };
    if (this._fitAtCurrentPosition(previous, trim)) {
      previous.frame = frame;
      previous.name = frame.name || frame.id;
      previous.sourceWidth = frame.width;
      previous.sourceHeight = frame.height;
      previous.trim = trim;
      this.contentUpdateCount += 1;
      this.operationCount += 1;
      this.lastAffected = { ...previous.reserved };
      return {
        item: previous,
        affected: { ...previous.reserved },
        repacked: false,
      };
    }

    const snapshot = {
      width: this.width,
      height: this.height,
      freeRects: this.freeRects.map((rect) => ({ ...rect })),
      growthEvents: this.growthEvents.slice(),
      repackCount: this.repackCount,
      contentUpdateCount: this.contentUpdateCount,
      deleteCount: this.deleteCount,
      operationCount: this.operationCount,
    };
    this._freeReservation(previous);
    try {
      const result = this.addFrame(frame);
      this.lastAffected = union(affectedBefore, result.affected);
      return { ...result, affected: this.lastAffected, repacked: true };
    } catch (error) {
      this.width = snapshot.width;
      this.height = snapshot.height;
      this.freeRects = snapshot.freeRects;
      this.growthEvents = snapshot.growthEvents;
      this.repackCount = snapshot.repackCount;
      this.contentUpdateCount = snapshot.contentUpdateCount;
      this.deleteCount = snapshot.deleteCount;
      this.operationCount = snapshot.operationCount;
      this.items.set(previous.id, previous);
      throw error;
    }
  }

  clear() {
    this.width = this.initialWidth;
    this.height = this.initialHeight;
    this.items = new Map();
    this.freeRects = [{ x: 0, y: 0, w: this.width, h: this.height }];
    this.repackCount = 0;
    this.fullRepackCount = 0;
    this.contentUpdateCount = 0;
    this.deleteCount = 0;
    this.growthEvents = [];
    this.lastAffected = null;
    this.operationCount = 0;
  }

  getFrame(id) {
    return this.items.get(id) || null;
  }

  snapshotLayout() {
    return [...this.items.values()].map((item) => ({
      id: item.id,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      rotated: item.rotated,
      reserved: { ...item.reserved },
    }));
  }

  stats() {
    const area = this.width * this.height;
    let trimmedArea = 0;
    for (const item of this.items.values()) {
      trimmedArea += item.trim.w * item.trim.h;
    }
    return {
      width: this.width,
      height: this.height,
      area,
      frameCount: this.items.size,
      trimmedArea,
      utilization: area ? trimmedArea / area : 0,
      repackCount: this.repackCount,
      fullRepackCount: this.fullRepackCount,
      contentUpdateCount: this.contentUpdateCount,
      deleteCount: this.deleteCount,
      growthCount: this.growthEvents.length,
      operationCount: this.operationCount,
      freeRectCount: this.freeRects.length,
    };
  }

  validate() {
    const errors = [];
    const items = [...this.items.values()];
    for (const item of items) {
      if (
        item.x < 0 ||
        item.y < 0 ||
        item.x + item.w > this.width ||
        item.y + item.h > this.height
      ) {
        errors.push(`${item.id} is outside the atlas.`);
      }
      if (
        item.reserved.x < 0 ||
        item.reserved.y < 0 ||
        item.reserved.x + item.reserved.w > this.width ||
        item.reserved.y + item.reserved.h > this.height
      ) {
        errors.push(`${item.id} reservation is outside the atlas.`);
      }
    }
    for (let a = 0; a < items.length; a += 1) {
      for (let b = a + 1; b < items.length; b += 1) {
        if (intersects(items[a], items[b])) {
          errors.push(`${items[a].id} overlaps ${items[b].id}.`);
        }
        if (intersects(items[a].reserved, items[b].reserved)) {
          errors.push(
            `${items[a].id} reservation overlaps ${items[b].id}.`,
          );
        }
      }
    }
    for (const free of this.freeRects) {
      if (
        free.x < 0 ||
        free.y < 0 ||
        free.x + free.w > this.width ||
        free.y + free.h > this.height
      ) {
        errors.push("A free rectangle is outside the atlas.");
      }
      for (const item of items) {
        if (intersects(free, item.reserved)) {
          errors.push(`Free rectangle overlaps ${item.id}.`);
        }
      }
    }
    return errors;
  }
}
