import puppeteer from "puppeteer";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, cond, detail = "") {
  const ok = !!cond;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
  if (!ok) failures++;
}

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio", "--no-sandbox"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => { console.log("PAGE_ERROR:", e.message); failures++; });
await page.goto("file:///home/hj/userfeedback/uid287/index.html");

const S = () => page.evaluate(() => window.__test.state);

// 1. 启动
await page.click("#btnPlay");
await sleep(2500);
let s = await S();
check("启动后 AudioContext 运行", s.ctxState === "running", s.ctxState);
check("三轨均有能量", s.energy.low > 1e-4 && s.energy.mid > 1e-4 && s.energy.high > 1e-4,
  `low=${s.energy.low.toFixed(4)} mid=${s.energy.mid.toFixed(4)} high=${s.energy.high.toFixed(4)}`);
check("混音总线有能量", s.energy.mix > 1e-4, s.energy.mix.toFixed(4));
check("残余误差被计算", s.energy.err >= 0 && s.energy.err < s.energy.mix,
  `err=${s.energy.err.toFixed(4)} (${(s.energy.err / s.energy.mix * 100).toFixed(1)}%)`);

// 2. 分离有效性：三轨能量序列应各自独立变化（不是同一信号）
const samples = { low: [], mid: [], high: [] };
for (let i = 0; i < 12; i++) {
  const st = await S();
  samples.low.push(st.energy.low); samples.mid.push(st.energy.mid); samples.high.push(st.energy.high);
  await sleep(250);
}
const variance = (a) => { const m = a.reduce((x, y) => x + y) / a.length; return a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length; };
const corr = (a, b) => {
  const ma = a.reduce((x, y) => x + y) / a.length, mb = b.reduce((x, y) => x + y) / a.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da === 0 || db === 0 ? 0 : n / Math.sqrt(da * db);
};
check("各轨能量随时间变化（门限在动态工作）",
  variance(samples.low) > 0 && variance(samples.mid) > 0 && variance(samples.high) > 0);
const cLM = Math.abs(corr(samples.low, samples.mid)), cMH = Math.abs(corr(samples.mid, samples.high));
check("分离后轨间相关性低（低-中、中-高）", cLM < 0.95 && cMH < 0.95, `r_lm=${cLM.toFixed(2)} r_mh=${cMH.toFixed(2)}`);
const gateStates = await page.evaluate(() => {
  const g = window.__test.state.gates;
  return [g.low.open, g.mid.open, g.high.open];
});
check("门限状态可读取", gateStates.every((v) => typeof v === "boolean"), JSON.stringify(gateStates));

// 3. 单轨试听
await page.click('.solo[data-track="mid"]');
await sleep(400);
s = await S();
check("单轨试听：仅中轨输出", s.solo.mid && s.gains.mid > 0.9 && s.gains.low < 0.1 && s.gains.high < 0.1 && s.gains.mix < 0.1,
  JSON.stringify(s.gains));
await page.click('.solo[data-track="mid"]');
await page.click('.solo[data-track="low"]');
await sleep(400);
s = await S();
check("切换单轨：仅低轨输出", s.solo.low && s.gains.low > 0.9 && s.gains.mid < 0.1 && s.gains.high < 0.1);
await page.click('.solo[data-track="low"]');
await sleep(400);
s = await S();
check("取消独奏：三轨恢复输出", s.gains.low > 0.9 && s.gains.mid > 0.9 && s.gains.high > 0.9);

// 4. 恢复原混音
await page.click("#btnMix");
await sleep(400);
s = await S();
check("恢复原混音：混音直通、分离轨静音", s.mixMode && s.gains.mix > 0.9 && s.gains.low < 0.1 && s.gains.mid < 0.1 && s.gains.high < 0.1,
  JSON.stringify(s.gains));
await page.click("#btnMix");
await sleep(400);
s = await S();
check("返回分离输出", !s.mixMode && s.gains.mix < 0.1 && s.gains.low > 0.9);

// 5. 暂停 / 继续
await page.click("#btnPause");
await sleep(300);
s = await S();
check("暂停：AudioContext 挂起", s.ctxState === "suspended", s.ctxState);
const e1 = (await S()).energy.mix;
await sleep(400);
const e2 = (await S()).energy.mix;
check("暂停时信号冻结", Math.abs(e1 - e2) < 1e-6, `${e1} vs ${e2}`);
await page.click("#btnPause");
await sleep(500);
s = await S();
check("继续：AudioContext 恢复运行", s.ctxState === "running" && s.energy.mix > 1e-4);

// 6. 参数重置
await page.evaluate(() => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("input")); };
  set("xLow", "500"); set("xHigh", "4000"); set("thr-low", "3.0");
});
await page.click('.solo[data-track="high"]');
await sleep(200);
s = await S();
check("修改参数生效",
  parseFloat(s.sliders.xLow) === 500 && parseFloat(s.sliders.xHigh) === 4000 &&
  parseFloat(s.sliders.thrLow) === 3.0 && s.solo.high,
  JSON.stringify(s.sliders));
await page.click("#btnReset");
await sleep(400);
s = await S();
check("重置：分频点恢复默认", s.sliders.xLow === "250" && s.sliders.xHigh === "2000",
  `xLow=${s.sliders.xLow} xHigh=${s.sliders.xHigh}`);
check("重置：门限灵敏度恢复默认",
  parseFloat(s.sliders.thrLow) === 1 && parseFloat(s.sliders.thrMid) === 1 && parseFloat(s.sliders.thrHigh) === 1);
check("重置：独奏清除、分离输出恢复", !s.solo.high && !s.mixMode && s.gains.low > 0.9 && s.gains.high > 0.9);
const xover = await page.evaluate(() => ({
  lp: document.getElementById("xLowVal").textContent,
  hp: document.getElementById("xHighVal").textContent,
}));
check("重置：界面分频标签同步", xover.lp === "250" && xover.hp === "2000");

await browser.close();
console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
