export const PERIODS = Object.freeze({
  day: {
    key: "day",
    label: "白天",
    time: "14:00",
    weather: "晴",
    chip: "日间高温",
    description: "太阳辐射与硬质铺装共同推高屋顶表面温度。",
    color: "#efa05e",
  },
  night: {
    key: "night",
    label: "夜间",
    time: "23:00",
    weather: "无云",
    chip: "夜间蓄热",
    description: "高密度建筑缓慢释放白天积蓄的热量，形成夜间热岛。",
    color: "#68c9c8",
  },
  heatwave: {
    key: "heatwave",
    label: "热浪",
    time: "15:00",
    weather: "橙色预警",
    chip: "极端热浪",
    description: "持续高温叠加低风速，连续屋面成为最强烈的热区。",
    color: "#f06f4d",
  },
});

export const BLOCKS = Object.freeze([
  { id: "B01", name: "槐荫北巷", zone: "北片区", row: 0, col: 0, layout: "quad", temps: { day: 33.6, night: 27.1, heatwave: 39.0 } },
  { id: "B02", name: "梧桐坊", zone: "北片区", row: 0, col: 1, layout: "rows", temps: { day: 35.9, night: 28.6, heatwave: 41.2 } },
  { id: "B03", name: "青石里", zone: "北片区", row: 0, col: 2, layout: "courtyard", temps: { day: 34.3, night: 27.8, heatwave: 39.8 } },
  { id: "B04", name: "北站前街", zone: "北片区", row: 0, col: 3, layout: "rows", temps: { day: 37.2, night: 29.4, heatwave: 43.5 } },
  { id: "B05", name: "电厂南巷", zone: "北片区", row: 0, col: 4, layout: "tower", temps: { day: 38.6, night: 30.7, heatwave: 45.2 } },
  { id: "B06", name: "滨水东区", zone: "滨水区", row: 0, col: 5, layout: "waterfront", temps: { day: 32.4, night: 25.9, heatwave: 36.4 } },

  { id: "B07", name: "榆树里", zone: "西片区", row: 1, col: 0, layout: "quad", temps: { day: 33.1, night: 26.8, heatwave: 37.8 } },
  { id: "B08", name: "中央公园", zone: "中央绿心", row: 1, col: 1, layout: "park", temps: { day: 31.4, night: 25.4, heatwave: 35.1 } },
  { id: "B09", name: "邮局街区", zone: "中央片区", row: 1, col: 2, layout: "rows", temps: { day: 35.3, night: 28.1, heatwave: 41.0 } },
  { id: "B10", name: "老城厢", zone: "中央片区", row: 1, col: 3, layout: "courtyard", temps: { day: 36.5, night: 29.8, heatwave: 42.8 } },
  { id: "B11", name: "五金巷", zone: "东片区", row: 1, col: 4, layout: "rows", temps: { day: 37.8, night: 30.3, heatwave: 44.0 } },
  { id: "B12", name: "河东里", zone: "东片区", row: 1, col: 5, layout: "quad", temps: { day: 32.9, night: 26.5, heatwave: 37.4 } },

  { id: "B13", name: "文化坊", zone: "西片区", row: 2, col: 0, layout: "courtyard", temps: { day: 34.1, night: 27.5, heatwave: 39.4 } },
  { id: "B14", name: "和平里", zone: "西片区", row: 2, col: 1, layout: "quad", temps: { day: 33.5, night: 27.0, heatwave: 38.8 } },
  { id: "B15", name: "柳树街", zone: "中央片区", row: 2, col: 2, layout: "strip", temps: { day: 35.4, night: 28.4, heatwave: 41.4 } },
  { id: "B16", name: "南门市集", zone: "中央片区", row: 2, col: 3, layout: "rows", temps: { day: 38.1, night: 31.2, heatwave: 45.0 } },
  { id: "B17", name: "旧仓巷", zone: "东片区", row: 2, col: 4, layout: "tower", temps: { day: 36.8, night: 30.1, heatwave: 43.7 } },
  { id: "B18", name: "滨水西区", zone: "滨水区", row: 2, col: 5, layout: "waterfront", temps: { day: 31.8, night: 25.8, heatwave: 36.0 } },

  { id: "B19", name: "香樟苑", zone: "南片区", row: 3, col: 0, layout: "quad", temps: { day: 32.7, night: 26.4, heatwave: 37.2 } },
  { id: "B20", name: "体育馆", zone: "南片区", row: 3, col: 1, layout: "tower", temps: { day: 33.9, night: 27.6, heatwave: 39.3 } },
  { id: "B21", name: "长街坊", zone: "南片区", row: 3, col: 2, layout: "strip", temps: { day: 35.0, night: 28.2, heatwave: 40.8 } },
  { id: "B22", name: "机修里", zone: "南片区", row: 3, col: 3, layout: "rows", temps: { day: 37.4, night: 30.6, heatwave: 44.4 } },
  { id: "B23", name: "新桥南巷", zone: "南片区", row: 3, col: 4, layout: "courtyard", temps: { day: 34.6, night: 27.9, heatwave: 40.1 } },
  { id: "B24", name: "河湾社区", zone: "滨水区", row: 3, col: 5, layout: "waterfront", temps: { day: 32.1, night: 25.7, heatwave: 36.6 } },
]);

export const MAP_WORLD = Object.freeze({
  width: 1080,
  height: 680,
  paddingX: 43,
  paddingTop: 44,
  paddingBottom: 54,
  roadX: 24,
  roadY: 22,
});

const OFFSETS = Object.freeze([-0.7, 0.45, -0.1, 0.75, 0.2, -0.35]);

function blockTemperature(block, period) {
  return block.temps[period];
}

function roofHeight(block, index) {
  if (block.layout === "tower") return 18 + ((block.row + index) % 3) * 6;
  if (block.layout === "rows") return 10 + ((block.col + index) % 3) * 4;
  return 8 + ((block.row + block.col + index) % 4) * 3;
}

function createBuilding(block, index, localRect, period) {
  const id = `${block.id}-${String(index + 1).padStart(2, "0")}`;
  const offset = OFFSETS[(block.row * 3 + block.col + index * 2) % OFFSETS.length];
  const temperature = Number((blockTemperature(block, period) + offset).toFixed(1));
  return {
    id,
    blockId: block.id,
    name: block.name,
    zone: block.zone,
    index,
    roofHeight: roofHeight(block, index),
    offsets: OFFSETS[(block.row * 3 + block.col + index * 2) % OFFSETS.length],
    world: localRect,
    temperatures: {
      day: Number((block.temps.day + offset).toFixed(1)),
      night: Number((block.temps.night + offset).toFixed(1)),
      heatwave: Number((block.temps.heatwave + offset).toFixed(1)),
    },
  };
}

function layoutRects(layout, x, y, width, height) {
  const gap = Math.max(5, width * 0.045);
  const halfW = (width - gap) / 2;
  const halfH = (height - gap) / 2;
  const thirdW = (width - gap * 2) / 3;

  switch (layout) {
    case "rows":
      return [
        { x, y, w: thirdW, h: halfH },
        { x: x + thirdW + gap, y, w: thirdW, h: halfH },
        { x: x + (thirdW + gap) * 2, y, w: thirdW, h: halfH },
        { x, y: y + halfH + gap, w: thirdW, h: halfH },
        { x: x + thirdW + gap, y: y + halfH + gap, w: thirdW, h: halfH },
        { x: x + (thirdW + gap) * 2, y: y + halfH + gap, w: thirdW, h: halfH },
      ];
    case "tower":
      return [
        { x, y, w: width * 0.62, h: height },
        { x: x + width * 0.62 + gap, y, w: width * 0.38 - gap, h: halfH },
        { x: x + width * 0.62 + gap, y: y + halfH + gap, w: width * 0.38 - gap, h: halfH },
      ];
    case "courtyard":
      return [
        { x, y, w: width, h: height * 0.38 },
        { x, y: y + height * 0.38 + gap, w: halfW, h: height * 0.62 - gap },
        { x: x + halfW + gap, y: y + height * 0.38 + gap, w: halfW, h: height * 0.62 - gap },
      ];
    case "park":
      return [
        { x, y: y + height * 0.56, w: width * 0.3, h: height * 0.44 },
        { x: x + width * 0.7, y, w: width * 0.3, h: height * 0.42 },
      ];
    case "waterfront":
      return [
        { x, y, w: halfW, h: height * 0.58 },
        { x: x + halfW + gap, y, w: halfW, h: height * 0.58 },
        { x: x + width * 0.18, y: y + height * 0.58 + gap, w: width * 0.64, h: height * 0.42 - gap },
      ];
    case "strip":
      return [
        { x, y, w: width, h: halfH * 0.78 },
        { x, y: y + halfH * 0.78 + gap, w: width, h: halfH * 0.78 },
        { x, y: y + halfH * 1.56 + gap * 2, w: width, h: height - halfH * 1.56 - gap * 2 },
      ];
    case "quad":
    default:
      return [
        { x, y, w: halfW, h: halfH },
        { x: x + halfW + gap, y, w: halfW, h: halfH },
        { x, y: y + halfH + gap, w: halfW, h: halfH },
        { x: x + halfW + gap, y: y + halfH + gap, w: halfW, h: halfH },
      ];
  }
}

export function createMapGeometry(period = "day") {
  const { width, height, paddingX, paddingTop, paddingBottom, roadX, roadY } = MAP_WORLD;
  const cols = 6;
  const rows = 4;
  const blockW = (width - paddingX * 2 - roadX * (cols - 1)) / cols;
  const blockH = (height - paddingTop - paddingBottom - roadY * (rows - 1)) / rows;
  const blocks = [];
  const buildings = [];

  for (const source of BLOCKS) {
    const x = paddingX + source.col * (blockW + roadX);
    const y = paddingTop + source.row * (blockH + roadY);
    const block = {
      ...source,
      temperature: source.temps[period],
      world: { x, y, w: blockW, h: blockH },
      inner: { x: x + 10, y: y + 14, w: blockW - 20, h: blockH - 24 },
    };
    blocks.push(block);

    layoutRects(source.layout, block.inner.x, block.inner.y, block.inner.w, block.inner.h)
      .forEach((rect, index) => {
        buildings.push(createBuilding(source, index, rect, period));
      });
  }

  return { blocks, buildings, width, height };
}

export const MAP_GEOMETRY = Object.freeze(createMapGeometry("day"));

export function weightedMean(buildings, period) {
  let area = 0;
  let total = 0;
  for (const building of buildings) {
    const buildingArea = building.world.w * building.world.h;
    area += buildingArea;
    total += building.temperatures[period] * buildingArea;
  }
  return area ? total / area : 0;
}

export function temperatureBounds(period) {
  const values = MAP_GEOMETRY.buildings.map((building) => building.temperatures[period]);
  return { min: Math.min(...values), max: Math.max(...values) };
}

export const PERIOD_STATS = Object.freeze(
  Object.fromEntries(
    Object.keys(PERIODS).map((period) => {
      const bounds = temperatureBounds(period);
      return [
        period,
        {
          ...bounds,
          average: weightedMean(MAP_GEOMETRY.buildings, period),
          count: MAP_GEOMETRY.buildings.length,
          area: MAP_GEOMETRY.buildings.reduce(
            (sum, building) => sum + building.world.w * building.world.h,
            0,
          ),
        },
      ];
    }),
  ),
);

export function getBuildingTemperature(building, period) {
  return building.temperatures[period];
}
