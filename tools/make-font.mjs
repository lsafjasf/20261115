// Rebuild the small Chinese subset font.
// Prerequisite: place the full Noto Sans SC TTF at fonts/notosc-src.ttf
// (download from google/fonts ofl/notosanssc), then run this script.
import Fontmin from 'fontmin';
import ttf2woff2 from 'ttf2woff2';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const sourceFiles = readdirSync('src').map((name) => `src/${name}`);
const source = ['index.html', ...sourceFiles]
  .map((file) => readFileSync(file, 'utf8')).join('');
const chars = [...new Set([...source].filter((ch) => {
  const code = ch.codePointAt(0);
  return /[\u3400-\u9fff]/.test(ch) ||
    (code >= 0x2000 && code <= 0x2bff) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xff00 && code <= 0xffef);
}))].sort().join('');

Fontmin()
  .src('fonts/notosc-src.ttf')
  .use(Fontmin.glyph({ text: chars, hinting: false }))
  .run((error, files) => {
    if (error) throw error;
    const subsetTtf = files[0].contents;
    const woff2 = ttf2woff2(subsetTtf);
    writeFileSync('fonts/noto-sc-subset.woff2', woff2);
    console.log(`fonts/noto-sc-subset.woff2: ${woff2.length} bytes, ${chars.length} glyphs`);
  });
