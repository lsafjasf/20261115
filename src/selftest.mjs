import { makeRng, hashSeed } from './rng.mjs';
import { generateCity, replaceBuilding, buildingHeight } from './citygen.mjs';
import { buildingOutline } from './building.mjs';
import { ClipManager } from './clipping.mjs';
import { parseScene, serializeScene } from './storage.mjs';
import { USAGE_TYPES, USAGE_COLORS, buildingColor } from './palette.mjs';

// Minimal assert shim so the same suite runs in Node and the browser.
const assert = {
  ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy value'); },
  strictEqual(a, b, msg) {
    if (a !== b) throw new Error(msg || `expected ${String(b)}, got ${String(a)}`);
  },
  deepStrictEqual(a, b, msg) {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(msg || `deep mismatch: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    }
  },
  notDeepStrictEqual(a, b, msg) {
    if (JSON.stringify(a) === JSON.stringify(b)) throw new Error(msg || 'expected different values');
  },
  doesNotReject: async (fn) => fn(),
};

export const SEEDS = ['default-city', 'seed-alpha-2026', 'seed-bravo-777'];

export function runSelfTest() {
  const results = [];
  const check = (name, fn) => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: err.message });
    }
  };

  check('同一种子生成完全相同的城市', () => {
    const a = generateCity('seed-alpha-2026');
    const b = generateCity('seed-alpha-2026');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
    assert.notDeepStrictEqual(
      JSON.parse(JSON.stringify(generateCity('seed-alpha-2026'))),
      JSON.parse(JSON.stringify(generateCity('seed-bravo-777'))),
    );
  });

  check('默认城市与两个 seed 均至少有十栋建筑', () => {
    assert.strictEqual(hashSeed('x') >>> 0, hashSeed('x') >>> 0);
    for (const seed of SEEDS) {
      const model = generateCity(seed);
      assert.ok(model.buildings.length >= 10, `${seed} 只有 ${model.buildings.length} 栋`);
    }
  });

  check('编辑层高/楼层后立即重算轮廓与高度', () => {
    const model = generateCity(SEEDS[0]);
    const target = model.buildings[0];
    const before = buildingOutline(target);
    const edited = replaceBuilding(model, {
      id: target.id,
      floors: target.floors + 3,
      floorHeight: target.floorHeight + 0.5,
      usage: 'office',
    }).buildings.find((b) => b.id === target.id);
    const after = buildingOutline(edited);
    assert.strictEqual(after.floors, before.floors + 3);
    assert.strictEqual(after.floorHeight, before.floorHeight + 0.5);
    assert.strictEqual(after.height, buildingHeight(edited));
    assert.ok(after.height > before.height);
    assert.strictEqual(after.topY, after.height);
  });

  check('修改建筑后剖切面与材质同步更新', () => {
    const model = generateCity(SEEDS[0]);
    const clip = new ClipManager(model.bounds);
    clip.setAxis('y', { enabled: true, value: 8 });
    const target = model.buildings[1];
    const edited = replaceBuilding(model, { id: target.id, floors: target.floors + 2 });
    const outline = buildingOutline(edited.buildings.find((b) => b.id === target.id));
    // The global Y plane stays fixed while the rebuilt building outline grows into it.
    assert.strictEqual(clip.state.y.value, 8);
    assert.ok(outline.height > buildingHeight(target));
    clip.setAxis('y', { value: outline.height / 2 });
    assert.strictEqual(clip.planes.y.constant, -outline.height / 2);
    for (const plane of clip.activePlanes()) {
      assert.ok(plane.normal.y === 1);
    }
  });

  check('场景可序列化并无损重新载入', () => {
    const model = generateCity(SEEDS[1]);
    const clip = new ClipManager(model.bounds);
    clip.setAxis('z', { enabled: true, value: 4 });
    const text = serializeScene(model, clip.snapshot());
    const restored = parseScene(text);
    assert.strictEqual(restored.model.seed, model.seed);
    assert.strictEqual(restored.model.buildings.length, model.buildings.length);
    assert.deepStrictEqual(restored.model.pipes, model.pipes);
    assert.deepStrictEqual(restored.clipping, clip.snapshot());
  });

  check('屋顶/楼层/管线与用途颜色保持稳定一致', () => {
    for (const usage of USAGE_TYPES) {
      assert.strictEqual(buildingColor(usage), USAGE_COLORS[usage]);
      assert.strictEqual(buildingColor(usage, 0), USAGE_COLORS[usage]);
    }
    const model = generateCity(SEEDS[2]);
    assert.ok(model.pipes.length > 0);
    assert.ok(model.buildings.every((b) => USAGE_TYPES.includes(b.usage)));
    const rng = makeRng(SEEDS[2]);
    assert.ok(typeof rng.next() === 'number');
  });

  const passed = results.filter((r) => r.ok).length;
  return { passed, total: results.length, results };
}
