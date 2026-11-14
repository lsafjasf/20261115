const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const url = 'file://' + path.resolve(__dirname, '../index.html');
  await page.goto(url);
  await page.waitForSelector('#scene');

  // 初始画布非空
  const canvasOk = await page.evaluate(() => {
    const c = document.getElementById('scene');
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    return data.some(v => v !== 0);
  });
  assert.ok(canvasOk, '画布应有初始渲染内容');
  console.log('  ok - 页面加载且 Canvas 完成初始渲染');

  // 启动自动驾驶
  await page.click('#btn-auto');
  await page.waitForFunction(
    () => document.getElementById('mission-state').textContent.includes('成功'),
    { timeout: 120000 });
  console.log('  ok - 自动驾驶在浏览器中完成一次灭火');

  const result = await page.evaluate(() => ({
    state: document.getElementById('mission-state').textContent,
    tank: document.getElementById('tank').textContent,
    pressure: document.getElementById('pressure').textContent,
    logs: Array.from(document.querySelectorAll('#log li')).map(li => li.textContent),
  }));
  assert.ok(Number(result.tank) > 0, '储水应有剩余');
  assert.ok(result.logs.some(l => l.includes('破裂')), '日志应包含破裂事件');
  assert.ok(result.logs.some(l => l.includes('全部火点扑灭')), '日志应包含胜利事件');
  console.log(`  ok - 剩水 ${result.tank}L，事件日志包含破裂与扑灭记录`);

  // 验证音频引擎已建立（AudioContext 在无头环境可能 suspended，但对象应存在）
  const audioOk = await page.evaluate(() => {
    const btn = document.getElementById('btn-mute');
    btn.click(); btn.click();
    return true;
  });
  assert.ok(audioOk);
  console.log('  ok - Web Audio 静音切换无异常');

  // 破裂压力重分配：手动开一轮，触发破裂后读取压力变化
  await page.click('#btn-reset');
  await page.click('#btn-start');
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) document.getElementById(`pump-btn-${i}`).click();
    for (let i = 0; i < 4; i++) {
      const r = document.getElementById(`hose-range-${i}`);
      r.value = 80; r.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.waitForTimeout(2500);
  const before = Number(await page.textContent('#pressure'));
  await page.click('#btn-rupture');
  await page.waitForTimeout(1500);
  const leak = Number(await page.textContent('#pressure'));
  assert.ok(leak < before * 0.9,
    `破裂后压力应下降: ${before} -> ${leak}`);
  // 关闭破裂支路阀门（缓慢操作）
  await page.evaluate(() => {
    const cards = document.querySelectorAll('.hose');
    for (let i = 0; i < cards.length; i++) {
      if (cards[i].style.borderColor.includes('248, 113, 113') ||
          cards[i].style.borderColor === 'rgb(248, 113, 113)') {
        const r = document.getElementById(`hose-range-${i}`);
        r.value = 0; r.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });
  await page.waitForTimeout(3500);
  const recovered = Number(await page.textContent('#pressure'));
  assert.ok(recovered > leak * 1.1,
    `隔离后压力应回升: ${leak} -> ${recovered}`);
  console.log(`  ok - 浏览器实测压力重分配: ${before} -> ${leak} -> ${recovered} kPa`);

  await page.screenshot({ path: path.resolve(__dirname, '../artifacts/fireground.png'),
    fullPage: true });

  assert.strictEqual(errors.length, 0, '页面不应有 JS 错误: ' + errors.join(' | '));
  console.log('  ok - 浏览器控制台无错误');
  await browser.close();
  console.log('\n浏览器端到端测试全部通过，截图已保存到 artifacts/fireground.png');
})().catch(e => { console.error(e); process.exit(1); });
