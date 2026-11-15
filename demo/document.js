export const document = {
  title: '三语混排样例',
  paragraphs: [
    {
      id: 'p1',
      text:
        '版本 2026 发布说明：混合排版引擎支持中文、English words 与 1,024 个数字单位混排，' +
        '例如 36.5°C、Q3 财报与 A4 页面在同一行内自动测量。',
      tuning: { widthFactor: 1.12 }
    },
    {
      id: 'p2',
      locked: true,
      frame: { x: 0, y: 132, w: 520, h: 96 },
      text:
        '锁定段落：2026 年 11 月，Build 9281 将 Canvas measurement 用于预览与导出，' +
        '此段落位置固定，不会参与重新流排。'
    },
    {
      id: 'p3',
      tuning: { widthFactor: 1.2 },
      text:
        '多语言校对团队需要在同一段落中处理「引号」、Quotation marks、符号编号 #17、' +
        '百分比 98.7% 以及 CJK spacing，自动断行必须避免标点出现在行首。为了演示孤字检测，这里继续补充若干内容，直到最后一行只留下一个字。'
    }
  ]
};

export const initialParams = {
  frameWidth: 520,
  frameHeight: 380,
  padding: 24,
  paraGap: 12,
  breakMode: 'greedy',
  justify: true,
  hangingPunct: true,
  font: {
    family: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", Arial, sans-serif',
    sizePx: 17,
    lineHeight: 2.0,
    cjkTracking: 0.8
  }
};
