export const CITY_SIZE = 118;
export const DEFAULT_SEED = "20261115";
export const COMPARE_SEED = "117340";

export const ROOF_TYPES = ["antenna", "tank", "spire", "helipad", "solar", "hvac"];

export const DEFAULT_PARAMS = Object.freeze({
  seed: DEFAULT_SEED,
  density: 11,
  variation: 72,
  roofDensity: 58,
  roofTypes: [...ROOF_TYPES],
});

const ROOF_LABELS = {
  antenna: "通信天线",
  tank: "屋顶水箱",
  spire: "塔尖",
  helipad: "停机坪",
  solar: "太阳能板",
  hvac: "设备机房",
  none: "无",
};

const STYLE_LABELS = {
  glass: "玻璃幕墙",
  stone: "石材立面",
  metal: "金属立面",
  brick: "暖砖立面",
};

const STYLE_COLORS = {
  glass: ["#668b88", "#739d95", "#557b7b", "#7ca49a", "#5e8584"],
  stone: ["#a99e85", "#b8aa8b", "#918b7c", "#c1b194", "#9e927c"],
  metal: ["#7e8e89", "#909d93", "#697d7c", "#84968f", "#718681"],
  brick: ["#9d6f5b", "#ad7a61", "#8c6557", "#b6886b", "#946c5d"],
};

export function normalizeSeed(value) {
  const cleaned = String(value ?? "").replace(/[^\d]/g, "").slice(0, 12);
  return cleaned || DEFAULT_SEED;
}

export function seedToNumber(seed) {
  let hash = 2166136261;
  const text = String(seed);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRng(seed, salt = 0) {
  let state = (seedToNumber(seed) + Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function range(random, min, max) {
  return min + (max - min) * random();
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function chooseStyle(random, floors) {
  if (floors > 34) return random() < 0.72 ? "glass" : "metal";
  if (floors > 18) return pick(random, ["glass", "metal", "stone"]);
  return pick(random, ["stone", "brick", "brick", "metal"]);
}

function chooseRoof(random, floors, allowedTypes) {
  if (!allowedTypes.length) return "none";
  const weighted = [];
  for (const type of allowedTypes) {
    let weight = 1;
    if (type === "spire") weight = floors > 30 ? 3.3 : 0.35;
    if (type === "helipad") weight = floors > 24 ? 2.1 : 0.2;
    if (type === "antenna") weight = floors > 18 ? 2.7 : 0.7;
    if (type === "tank") weight = floors < 24 ? 2 : 0.75;
    if (type === "solar") weight = floors < 18 ? 2.6 : 0.6;
    if (type === "hvac") weight = floors < 30 ? 1.8 : 0.75;
    weighted.push({ type, weight });
  }
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random() * total;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) return item.type;
  }
  return weighted[weighted.length - 1].type;
}

function buildTiers(floors, footprint, random) {
  if (floors > 40) {
    const splits = [0.62, 0.23, 0.15];
    return splits.map((split, index) => ({
      floors: Math.max(1, Math.round(floors * split)),
      width: footprint.width * (index === 0 ? 1 : index === 1 ? 0.82 : 0.63),
      depth: footprint.depth * (index === 0 ? 1 : index === 1 ? 0.82 : 0.63),
    }));
  }
  if (floors > 25) {
    return [
      { floors: Math.round(floors * 0.76), ...footprint },
      { floors: floors - Math.round(floors * 0.76), width: footprint.width * 0.76, depth: footprint.depth * 0.76 },
    ];
  }
  return [{ floors, ...footprint }];
}

function isParkCell(x, z, grid, random, centerDistance) {
  if (centerDistance < 0.17 && random() < 0.18) return true;
  if (x > 1 && x < grid - 2 && z > 1 && z < grid - 2 && random() < 0.035) return true;
  return random() < 0.025;
}

export function generateCity(inputParams = {}) {
  const params = {
    ...DEFAULT_PARAMS,
    ...inputParams,
    seed: normalizeSeed(inputParams.seed ?? DEFAULT_PARAMS.seed),
    roofTypes: [...(inputParams.roofTypes ?? DEFAULT_PARAMS.roofTypes)],
  };
  const density = clamp(Math.round(params.density), 6, 16);
  const variation = clamp(params.variation, 0, 100) / 100;
  const roofDensity = clamp(params.roofDensity, 0, 100) / 100;
  const random = createRng(params.seed, 17);
  const step = CITY_SIZE / density;
  const buildings = [];
  const parks = [];
  const trees = [];
  let buildingIndex = 0;

  for (let zIndex = 0; zIndex < density; zIndex += 1) {
    for (let xIndex = 0; xIndex < density; xIndex += 1) {
      const x = -CITY_SIZE / 2 + step * (xIndex + 0.5);
      const z = -CITY_SIZE / 2 + step * (zIndex + 0.5);
      const centerDistance = Math.sqrt((x / (CITY_SIZE / 2)) ** 2 + (z / (CITY_SIZE / 2)) ** 2);
      const centerWeight = clamp(1 - centerDistance / 1.12, 0, 1);

      if (isParkCell(xIndex, zIndex, density, random, centerDistance)) {
        const parkWidth = step * range(random, 0.55, 0.82);
        const parkDepth = step * range(random, 0.55, 0.82);
        parks.push({ x, z, width: parkWidth, depth: parkDepth, shade: random() });
        const treeCount = 1 + Math.floor(random() * 3);
        for (let treeIndex = 0; treeIndex < treeCount; treeIndex += 1) {
          trees.push({
            x: x + range(random, -parkWidth * 0.32, parkWidth * 0.32),
            z: z + range(random, -parkDepth * 0.32, parkDepth * 0.32),
            scale: range(random, 0.55, 1.1),
            hue: random(),
          });
        }
        continue;
      }

      const openChance = 0.045 + (1 - centerWeight) * 0.05;
      if (random() < openChance) {
        parks.push({
          x,
          z,
          width: step * range(random, 0.36, 0.7),
          depth: step * range(random, 0.36, 0.7),
          shade: random(),
        });
        continue;
      }

      const lowBase = range(random, 3, 10);
      const centralLift = 0.16 + centerWeight * 0.84;
      const towerChance = 0.16 + centerWeight * 0.58;
      let floors;
      if (random() < towerChance) {
        const towerPower = 0.55 + variation * 1.9;
        floors = Math.round(lowBase + centralLift * Math.pow(random(), towerPower) * (25 + variation * 44));
      } else {
        floors = Math.round(lowBase + random() * (8 + variation * 11) * (0.55 + centerWeight * 0.6));
      }
      floors = clamp(floors, 2, 64);

      const lotRatio = range(random, 0.46, 0.72);
      const slenderness = floors > 36 ? range(random, 0.7, 0.9) : 1;
      const footprint = {
        width: step * lotRatio * slenderness,
        depth: step * range(random, 0.46, 0.72) * slenderness,
      };
      const style = chooseStyle(random, floors);
      const allowedRoofs = params.roofTypes.filter((type) => ROOF_TYPES.includes(type));
      const hasRoof = allowedRoofs.length > 0 && random() < 0.25 + roofDensity * 0.7;
      const roof = hasRoof ? chooseRoof(random, floors, allowedRoofs) : "none";
      const storyHeight = range(random, 0.86, 1.18) * (1.04 + variation * 0.18);
      const tierData = buildTiers(floors, footprint, random);
      const tierTotal = tierData.reduce((sum, tier) => sum + tier.floors, 0);
      if (tierTotal !== floors) tierData[tierData.length - 1].floors += floors - tierTotal;

      buildingIndex += 1;
      buildings.push({
        id: `B-${String(buildingIndex).padStart(3, "0")}`,
        x,
        z,
        width: footprint.width,
        depth: footprint.depth,
        floors,
        storyHeight,
        height: floors * storyHeight,
        style,
        color: pick(random, STYLE_COLORS[style]),
        roof,
        roofLabel: ROOF_LABELS[roof],
        styleLabel: STYLE_LABELS[style],
        tiers: tierData,
        seed: Math.floor(random() * 999999),
        rotation: random() < 0.7 ? 0 : Math.PI / 2,
      });
    }
  }

  if (!buildings.length) {
    buildings.push({
      id: "B-001",
      x: 0,
      z: 0,
      width: step * 0.62,
      depth: step * 0.62,
      floors: 24,
      storyHeight: 1,
      height: 24,
      style: "glass",
      color: "#739d95",
      roof: "antenna",
      roofLabel: ROOF_LABELS.antenna,
      styleLabel: STYLE_LABELS.glass,
      tiers: [{ floors: 24, width: step * 0.62, depth: step * 0.62 }],
      seed: 1,
      rotation: 0,
    });
  }

  const maxFloors = Math.max(...buildings.map((building) => building.floors));
  const avgFloors = buildings.reduce((sum, building) => sum + building.floors, 0) / buildings.length;
  const profile = sampleSkyline(buildings, 192);

  return {
    params,
    density,
    step,
    buildings,
    parks,
    trees,
    maxFloors,
    avgFloors,
    profile,
    areaWidth: CITY_SIZE,
    areaDepth: CITY_SIZE,
  };
}

export function sampleSkyline(buildings, samples = 160) {
  const profile = new Array(samples).fill(0);
  for (const building of buildings) {
    const left = clamp((building.x - building.width / 2 + CITY_SIZE / 2) / CITY_SIZE, 0, 1);
    const right = clamp((building.x + building.width / 2 + CITY_SIZE / 2) / CITY_SIZE, 0, 1);
    const start = Math.floor(left * (samples - 1));
    const end = Math.ceil(right * (samples - 1));
    for (let index = start; index <= end; index += 1) {
      profile[index] = Math.max(profile[index], building.height);
    }
  }
  const peak = Math.max(...profile, 1);
  return profile.map((height) => height / peak);
}

export function skylineDistance(profileA, profileB) {
  const length = Math.min(profileA.length, profileB.length);
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    sum += (profileA[index] - profileB[index]) ** 2;
  }
  return Math.sqrt(sum / length);
}

export function cityStats(city) {
  const roofCount = city.buildings.filter((building) => building.roof !== "none").length;
  const towerCount = city.buildings.filter((building) => building.floors >= 30).length;
  return {
    count: city.buildings.length,
    maxFloors: city.maxFloors,
    avgFloors: city.avgFloors,
    roofCount,
    towerCount,
    greenRatio: city.parks.length / Math.max(1, city.buildings.length + city.parks.length),
  };
}

export function describeBuilding(building) {
  if (!building) return "";
  if (building.floors >= 42) return "超高层";
  if (building.floors >= 27) return "高层";
  if (building.floors >= 14) return "中高层";
  return "低层";
}
