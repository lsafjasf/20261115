const { chromium } = require("playwright");
const { PNG } = require("pngjs");
const http = require("http"); const fs = require("fs"); const path = require("path");
const ROOT = "/home/hj/userfeedback/uid257";
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css" };
(async () => {
  const srv = http.createServer((req,res)=>{ const p=path.join(ROOT, req.url==="/"?"index.html":req.url.split("?")[0]);
    fs.readFile(p,(e,d)=>{ if(e){res.writeHead(404);res.end();return;} res.writeHead(200,{"Content-Type":MIME[path.extname(p)]||"text/plain"}); res.end(d); }); });
  await new Promise(r=>srv.listen(0,r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  await page.waitForFunction(() => typeof render === "function");
  const box = await page.locator("#stage").boundingBox();
  console.log("box:", box);
  const shot = PNG.sync.read(await page.screenshot({clip:{x:box.x+1,y:box.y+1,width:960,height:600}}));
  const dataUrl = await page.evaluate(()=>document.getElementById("stage").toDataURL("image/png"));
  const canv = PNG.sync.read(Buffer.from(dataUrl.split(",")[1],"base64"));
  const counts = {};
  for (let i=0;i<canv.data.length;i+=4){
    const d = Math.abs(canv.data[i]-shot.data[i])+Math.abs(canv.data[i+1]-shot.data[i+1])+Math.abs(canv.data[i+2]-shot.data[i+2]);
    if (d>4){ const p=i/4; const x=p%960, y=(p/960)|0; const key=`${Math.round(x/120)},${Math.round(y/120)}`; counts[key]=(counts[key]||0)+1; }
  }
  console.log(counts);
  await browser.close(); srv.close();
})();
