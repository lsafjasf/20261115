// 站台平面：28 列 x 18 行网格
// 0=地面 1=墙体 2=出口
export const COLS = 28;
export const ROWS = 18;

export const T = { FLOOR: 0, WALL: 1, EXIT: 2 };

// 通行状态：open 双向 / up 只准向上（站台->站厅）/ down 反向 / closed 关闭
export const DIR = { OPEN: 'open', UP: 'up', DOWN: 'down', CLOSED: 'closed' };

export function buildLayout() {
  const cells = Array.from({ length: ROWS }, () => new Array(COLS).fill(T.FLOOR));

  // 左右边界与底部轨道区（15-17 行为列车，不可通行）
  for (let r = 0; r < ROWS; r++) {
    cells[r][0] = T.WALL;
    cells[r][COLS - 1] = T.WALL;
  }
  for (let r = 15; r < ROWS; r++) {
    for (let c = 1; c < COLS - 1; c++) cells[r][c] = T.WALL;
  }

  // 第 3 行：站厅与站台之间的隔墙，仅闸门处可通行
  const gateCols = [4, 10, 17, 23];
  for (let c = 1; c < COLS - 1; c++) cells[3][c] = T.WALL;

  // 第 8 行：设备/座椅区形成的通道瓶颈，留 5 条通道
  const channelCols = [3, 9, 14, 19, 24];
  for (let c = 1; c < COLS - 1; c++) cells[8][c] = T.WALL;

  const exits = gateCols.map((c, i) => ({ id: `E${i}`, row: 0, col: c }));
  exits.forEach((e) => { cells[e.row][e.col] = T.EXIT; });

  const gates = gateCols.map((c, i) => {
    cells[3][c] = T.FLOOR;
    return { id: `G${i}`, kind: 'gate', row: 3, col: c, dir: DIR.OPEN, smokeShut: false };
  });

  const channels = channelCols.map((c, i) => {
    cells[8][c] = T.FLOOR;
    return { id: `C${i}`, kind: 'channel', row: 8, col: c, dir: DIR.OPEN };
  });

  // 排烟机：一台靠近火源（右下），一台在左侧大厅
  const fans = [
    { id: 'F0', row: 12, col: 22, on: false },
    { id: 'F1', row: 6, col: 2, on: false },
  ];

  // 烟感：烟雾浓度越过阈值即报警，触发警笛与提示
  const sensors = [
    { id: 'S0', row: 10, col: 22, level: 0, alarm: false },
    { id: 'S1', row: 8, col: 24, level: 0, alarm: false },
    { id: 'S2', row: 5, col: 17, level: 0, alarm: false },
  ];

  // 火源（右下角站台），持续产生烟雾
  const smokeSource = { id: 'FIRE', row: 13, col: 24, emit: 1.6 };

  // 乘客生成点：14 行站台边缘
  const spawns = [];
  for (let c = 2; c <= 25; c++) spawns.push({ row: 14, col: c });

  // 安全区：站厅 0-2 行
  const safeZone = [];
  for (let r = 0; r <= 2; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      if (cells[r][c] !== T.WALL) safeZone.push({ row: r, col: c });
    }
  }

  return {
    cols: COLS, rows: ROWS, cells,
    exits, gates, channels, fans, sensors,
    smokeSource, spawns, safeZone,
    gateCols, channelCols,
  };
}
