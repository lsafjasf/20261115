/*
 * render.js — 离线渲染验证：生成原图（带标记）、轻微拉伸、强烈拉伸三张 PNG，
 * 并做"重复列检测"，确认没有整列复制造成的重复带。
 *
 * 用法: node test/render.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Landscape = require('../js/landscape.js');
const Stretch = require('../js/stretch.js');
const { encodePNG } = require('../js/png.js');

const OUT = path.join(__dirname, '..', 'artifacts');
fs.mkdirSync(OUT, { recursive: true });

const SRC_W = 480, SRC_H = 300;
const boundaries = [160, 320];

function withMarkers(img, offsets) {
  const copy = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  Stretch.drawMarkers(copy, offsets);
  return copy;
}

function save(name, img) {
  fs.writeFileSync(path.join(OUT, name), encodePNG(img));
  console.log('写出', name, img.width + 'x' + img.height);
}

// 重复列检测：统计"与左侧相邻列完全相同"的列数。
// 整列复制（nearest 拉伸）会产生大量相同列；本算法应接近 0。
function countDuplicateColumns(img) {
  const { data, width, height } = img;
  let dup = 0;
  for (let x = 1; x < width; x++) {
    let same = true;
    for (let y = 0; y < height; y += 3) { // 抽样加速
      const a = (y * width + x) * 4, b = (y * width + x - 1) * 4;
      if (data[a] !== data[b] || data[a + 1] !== data[b + 1] || data[a + 2] !== data[b + 2]) {
        same = false; break;
      }
    }
    if (same) dup++;
  }
  return dup;
}

const src = Landscape.generateLandscape({ width: SRC_W, height: SRC_H, seed: 7 });

save('original_marked.png', withMarkers(src, boundaries));

const mild = Stretch.stretchImage(src, boundaries, [200, 240, 200], {});
save('stretch_mild.png', withMarkers(mild, mild.offsets));

const strong = Stretch.stretchImage(src, boundaries, [480, 480, 480], {});
save('stretch_strong.png', withMarkers(strong, strong.offsets));

for (const [name, img] of [['mild', mild], ['strong', strong]]) {
  const dup = countDuplicateColumns(img);
  console.log(`${name}: 宽 ${img.width}, 重复列 ${dup} (${(dup / img.width * 100).toFixed(2)}%)`);
}
console.log('完成');
