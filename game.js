// 入口：固定步长仿真 + Canvas 渲染 + Web Audio + 键盘/触摸输入。
import { Simulation, WORLD, TARGETS } from "./sim.js";
import { Renderer } from "./renderer.js";
import { GameAudio } from "./audio.js";
import { Autopilot } from "./autopilot.js";

const canvas = document.getElementById("scene");
const sim = new Simulation();
const renderer = new Renderer(canvas);
const audio = new GameAudio();
const pilot = new Autopilot();

const state = {
  auto: false,
  trail: [],
  lastResultCount: 0,
  lastStatus: "flying",
  accumulator: 0,
  lastTime: performance.now(),
};

const hud = {
  alt: document.getElementById("hud-alt"),
  vy: document.getElementById("hud-vy"),
  vx: document.getElementById("hud-vx"),
  fuel: document.getElementById("hud-fuel"),
  fuelText: document.getElementById("hud-fuel-text"),
  mail: document.getElementById("hud-mail"),
  done: document.getElementById("hud-done"),
};

const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");

function setControl(name, value) {
  sim.controls[name] = value;
}

function toggleAuto() {
  audio.ensure();
  state.auto = !state.auto;
  document.getElementById("btn-auto").classList.toggle("active", state.auto);
  if (!state.auto) {
    sim.controls.burn = false;
    sim.controls.vent = false;
    sim.controls.rudder = 0;
  }
}

function restart() {
  sim.reset();
  pilot.reset();
  state.auto = false;
  state.trail = [];
  state.lastResultCount = 0;
  state.lastStatus = "flying";
  overlay.classList.add("hidden");
  document.getElementById("btn-auto").classList.remove("active");
}

function tryDrop() {
  audio.ensure();
  const res = sim.dropMail();
  if (res.ok) audio.drop();
  flashHint(res.reason, res.ok);
}

let hintTimer = null;
function flashHint(text, ok) {
  const el = document.getElementById("hint");
  el.dataset.default = el.dataset.default || el.innerHTML;
  el.innerHTML = `<b style="color:${ok ? "#7fe0a3" : "#ff9b8f"}">${text}</b>`;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    el.innerHTML = el.dataset.default;
  }, 1800);
}

// —— 键盘输入 ——
const keys = new Set();
window.addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
    e.preventDefault();
  }
  audio.ensure();
  if (e.repeat) return;
  keys.add(e.key.toLowerCase());
  if (e.key === " ") tryDrop();
  if (e.key.toLowerCase() === "r") restart();
  if (e.key.toLowerCase() === "p") toggleAuto();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

function readKeyboard() {
  if (state.auto) return;
  const burn = keys.has("arrowup") || keys.has("w");
  const vent = keys.has("arrowdown") || keys.has("s");
  const left = keys.has("arrowleft") || keys.has("a");
  const right = keys.has("arrowright") || keys.has("d");
  setControl("burn", burn);
  setControl("vent", vent);
  setControl("rudder", (right ? 1 : 0) - (left ? 1 : 0));
}

// —— 触摸/鼠标按钮（按住生效） ——
function holdButton(id, onDown, onUp) {
  const el = document.getElementById(id);
  const down = (e) => {
    e.preventDefault();
    audio.ensure();
    el.classList.add("active");
    onDown();
  };
  const up = (e) => {
    e.preventDefault();
    el.classList.remove("active");
    onUp();
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointerleave", up);
  el.addEventListener("pointercancel", up);
}

holdButton("btn-burn", () => { state.auto = false; setControl("burn", true); }, () => setControl("burn", false));
holdButton("btn-vent", () => { state.auto = false; setControl("vent", true); }, () => setControl("vent", false));
holdButton("btn-left", () => { state.auto = false; setControl("rudder", -1); }, () => setControl("rudder", 0));
holdButton("btn-right", () => { state.auto = false; setControl("rudder", 1); }, () => setControl("rudder", 0));
document.getElementById("btn-drop").addEventListener("click", tryDrop);
document.getElementById("btn-auto").addEventListener("click", toggleAuto);
document.getElementById("btn-reset").addEventListener("click", restart);
document.getElementById("overlay-btn").addEventListener("click", restart);

// —— 主循环：固定步长物理 + 每帧渲染 ——
function frame(now) {
  const elapsed = Math.min(0.1, (now - state.lastTime) / 1000);
  state.lastTime = now;
  state.accumulator += elapsed;

  readKeyboard();
  while (state.accumulator >= WORLD.dt) {
    if (state.auto) pilot.update(sim, WORLD.dt);
    sim.step();
    state.accumulator -= WORLD.dt;
  }

  // 气球航迹（渲染用，限长）
  state.trail.push({ x: sim.x, z: sim.z });
  if (state.trail.length > 260) state.trail.shift();

  handleEvents();
  renderer.draw(sim, state.trail);
  audio.update(sim);
  updateHud();
  requestAnimationFrame(frame);
}

function handleEvents() {
  // 新落地的邮件
  while (state.lastResultCount < sim.results.length) {
    const r = sim.results[state.lastResultCount];
    if (r && !r.pending) {
      if (r.success) {
        audio.delivered();
        flashHint(`✅ ${r.reason}`, true);
      } else {
        audio.missed();
        flashHint(`❌ ${r.reason}`, false);
      }
    }
    state.lastResultCount++;
  }

  if (sim.status !== state.lastStatus) {
    state.lastStatus = sim.status;
    if (sim.status === "won") {
      audio.win();
      showOverlay("任务完成 🎉", buildSummary(true));
    } else if (sim.status === "crashed") {
      audio.crash();
      showOverlay("气球坠毁", buildSummary(false) + "\n触地速度过大，注意提前拉起燃烧器。");
    } else if (sim.status === "outoffuel") {
      audio.missed();
      showOverlay("燃料耗尽", buildSummary(false) + "\n规划航线，减少无效燃烧。");
    }
  }
}

function buildSummary(won) {
  const lines = sim.results
    .filter((r) => !r.pending)
    .map((r) => `${r.id + 1}号袋：${r.success ? "✅" : "❌"} 投出高度 ${r.altitudeAtDrop?.toFixed(0) ?? "?"}m，${r.reason}`);
  return [
    `成功送达 ${sim.delivered} / ${TARGETS.length} 袋`,
    `剩余燃料 ${sim.fuel.toFixed(1)}% · 用时 ${sim.t.toFixed(0)} 秒`,
    "",
    ...lines,
  ].join("\n");
}

function showOverlay(title, text) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlay.classList.remove("hidden");
}

function updateHud() {
  hud.alt.textContent = `${sim.altitude.toFixed(0)} m`;
  hud.vy.textContent = `${sim.vz.toFixed(1)} m/s`;
  hud.vx.textContent = `${sim.vx.toFixed(1)} m/s`;
  hud.fuel.style.width = `${sim.fuel}%`;
  hud.fuel.classList.toggle("low", sim.fuel < 25);
  hud.fuelText.textContent = `${sim.fuel.toFixed(0)}%`;
  hud.mail.textContent = `${sim.bagsLeft} / ${TARGETS.length}`;
  hud.done.textContent = `${sim.delivered} / ${TARGETS.length}`;
}

requestAnimationFrame(frame);
