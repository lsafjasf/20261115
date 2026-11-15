import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
await page.context().addInitScript(() => {
  window.__reportDataUrl = null;
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith("data:image/png")) {
      window.__reportDataUrl = this.href;
      window.__reportName = this.download;
      return;
    }
    return origClick.call(this);
  };
});

await page.goto(`${process.env.TEST_BASE}/app/index.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);

await page.evaluate(() => {
  const rs = document.getElementById("rangeStart");
  rs.value = 30;
  rs.dispatchEvent(new Event("input", { bubbles: true }));
  const re = document.getElementById("rangeEnd");
  re.value = 80;
  re.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.click("#exportBtn");
await page.waitForTimeout(500);

const data = await page.evaluate(() => ({ url: window.__reportDataUrl, name: window.__reportName }));
if (!data.url) throw new Error("未捕获到报告 dataURL");
const b64 = data.url.split(",")[1];
writeFileSync("artifacts/" + data.name, Buffer.from(b64, "base64"));
console.log("saved artifacts/" + data.name, Buffer.byteLength(b64, "base64"), "bytes");
await browser.close();
