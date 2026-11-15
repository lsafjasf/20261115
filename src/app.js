import { CameraAudio } from "./audio.js";
import { NightScene, TARGET_TOLERANCE, describeSettings } from "./scene.js";

const SHUTTERS = [
  { seconds: 1 / 250, label: "1/250 s" },
  { seconds: 1 / 125, label: "1/125 s" },
  { seconds: 1 / 60, label: "1/60 s" },
  { seconds: 1 / 30, label: "1/30 s" },
  { seconds: 1 / 15, label: "1/15 s" },
  { seconds: 1 / 8, label: "1/8 s" },
  { seconds: 1 / 4, label: "1/4 s" },
  { seconds: 1 / 2, label: "1/2 s" },
  { seconds: 1, label: "1 s" },
  { seconds: 2, label: "2 s" },
  { seconds: 4, label: "4 s" },
  { seconds: 8, label: "8 s" },
];

const ISOS = [100, 200, 400, 800, 1600, 3200, 6400, 12800];
const APERTURES = [1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11];

const $ = (selector) => document.querySelector(selector);
const canvas = $("#viewfinder");
const scene = new NightScene(canvas);
const audio = new CameraAudio();

const ui = {
  shutterSlider: $("#shutterSlider"),
  isoSlider: $("#isoSlider"),
  apertureSlider: $("#apertureSlider"),
  shutterValue: $("#shutterValue"),
  isoValue: $("#isoValue"),
  apertureValue: $("#apertureValue"),
  evValue: $("#evValue"),
  exposureState: $("#exposureState"),
  meterNeedle: $("#meterNeedle"),
  meterCard: $("#meterCard"),
  meterHelp: $("#meterHelp"),
  noiseStat: $("#noiseStat"),
  noiseDots: $("#noiseDots"),
  trailStat: $("#trailStat"),
  trailBar: $("#trailBar"),
  highlightStat: $("#highlightStat"),
  highlightLine: $("#highlightLine"),
  hudAperture: $("#hudAperture"),
  hudShutter: $("#hudShutter"),
  hudIso: $("#hudIso"),
  hudEv: $("#hudEv"),
  hudNoise: $("#hudNoise"),
  viewMode: $("#viewMode"),
  frames: $("#frames"),
  filmHint: $("#filmHint"),
  progressText: $("#progressText"),
  progressPips: [...document.querySelectorAll("#progressPips i")],
  shutterBtn: $("#shutterBtn"),
  shutterNote: $("#shutterNote"),
  timerLayer: $("#timerLayer"),
  timerValue: $("#timerValue"),
  timerProgress: $("#timerProgress"),
  shutterCurtain: $("#shutterCurtain"),
  toast: $("#toast"),
  clock: $("#clock"),
  audioToggle: $("#audioToggle"),
  compareModal: $("#compareModal"),
  compareGrid: $("#compareGrid"),
  compareSummary: $("#compareSummary"),
  closeCompare: $("#closeCompare"),
  keepShooting: $("#keepShooting"),
  restartSession: $("#restartSession"),
};

const state = {
  settings: {
    shutterIndex: 7,
    isoIndex: 1,
    apertureIndex: 0,
  },
  shots: [],
  capturing: false,
  soundEnabled: true,
  toastTimer: 0,
  lastFrame: 0,
};

let toastTimer = 0;
let animationStart = performance.now();

function currentSettings() {
  return {
    seconds: SHUTTERS[state.settings.shutterIndex].seconds,
    iso: ISOS[state.settings.isoIndex],
    aperture: APERTURES[state.settings.apertureIndex],
  };
}

function formatSigned(value) {
  if (Math.abs(value) < 0.05) return "+0.0";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

function settingsSignature(settings = currentSettings()) {
  return `${settings.aperture}|${settings.seconds}|${settings.iso}`;
}

function settingsLabel(settings = currentSettings()) {
  const shutter = SHUTTERS.find((item) => item.seconds === settings.seconds);
  return `f/${settings.aperture} · ${shutter?.label ?? settings.seconds} · ISO ${settings.iso}`;
}

function noiseLabel(rating) {
  return ["很低", "低", "中等", "高", "极高"][rating - 1];
}

function trailLabel(normalized) {
  if (normalized < 0.18) return "点状";
  if (normalized < 0.42) return "较短";
  if (normalized < 0.68) return "明显";
  return "长光轨";
}

function updateRangeFill(input) {
  const ratio = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
  input.style.setProperty("--fill", `${Math.round(ratio * 100)}%`);
}

function updateInterface() {
  const settings = currentSettings();
  const info = describeSettings(settings);
  const evText = formatSigned(info.ev);
  const noiseRating = info.noise.rating;
  const highlightCopy = {
    safe: "安全",
    warning: "接近溢出",
    clipped: "高光溢出",
  }[info.highlight];

  ui.shutterValue.textContent = SHUTTERS[state.settings.shutterIndex].label;
  ui.isoValue.textContent = `ISO ${settings.iso}`;
  ui.apertureValue.textContent = `f/${settings.aperture}`;
  ui.evValue.textContent = evText;
  ui.hudEv.textContent = evText;
  ui.hudAperture.textContent = `f/${settings.aperture}`;
  ui.hudShutter.textContent = SHUTTERS[state.settings.shutterIndex].label;
  ui.hudIso.textContent = `ISO ${settings.iso}`;
  ui.hudNoise.textContent = `噪点 ${noiseRating}/5`;
  ui.noiseStat.textContent = noiseLabel(noiseRating);
  ui.trailStat.textContent = trailLabel(info.trail.normalized);
  ui.highlightStat.textContent = highlightCopy;

  const needlePosition = 50 + (Math.max(-3, Math.min(3, info.ev)) / 6) * 100;
  ui.meterNeedle.style.left = `${needlePosition}%`;
  ui.meterNeedle.classList.toggle("is-ok", info.inTarget);
  ui.meterCard.classList.toggle("is-on-target", info.inTarget);
  ui.exposureState.classList.toggle("is-ok", info.inTarget);
  ui.exposureState.classList.toggle("is-hot", info.ev > TARGET_TOLERANCE);

  if (info.inTarget) {
    ui.exposureState.textContent = "曝光合适";
    ui.meterHelp.textContent = "已进入绿色目标区，可按下快门记录底片。";
  } else if (info.ev < 0) {
    ui.exposureState.textContent = `欠曝 ${Math.abs(info.ev).toFixed(1)} EV`;
    ui.meterHelp.textContent = "增加曝光时间、感光度，或开大光圈。";
  } else {
    ui.exposureState.textContent = `过曝 ${info.ev.toFixed(1)} EV`;
    ui.meterHelp.textContent = "减少曝光时间、感光度，或缩小光圈。";
  }

  ui.noiseDots.querySelectorAll("i").forEach((dot, index) => {
    dot.classList.toggle("is-on", index < noiseRating);
    dot.classList.toggle("is-high", index < noiseRating && noiseRating >= 4);
  });
  ui.trailBar.style.width = `${Math.round(12 + info.trail.normalized * 88)}%`;
  ui.trailBar.style.background = info.trail.normalized > 0.6 ? "var(--amber)" : "var(--cyan)";
  ui.highlightLine.className = "status-line";
  if (info.highlight === "warning") ui.highlightLine.classList.add("is-warn");
  if (info.highlight === "clipped") ui.highlightLine.classList.add("is-bad");

  ui.viewMode.textContent = `实时噪声 · ${noiseRating}/5`;
  [ui.shutterSlider, ui.isoSlider, ui.apertureSlider].forEach(updateRangeFill);
  ui.shutterBtn.disabled = state.capturing;
  ui.shutterNote.textContent = info.inTarget
    ? "曝光已达标 · 每张照片必须使用不同参数"
    : `目标区间 0.0 EV ±${TARGET_TOLERANCE.toFixed(2)} · 当前 ${evText} EV`;
}

function renderLive(now) {
  const time = now / 1000;
  scene.render(currentSettings(), time, {
    noise: true,
    seed: Math.floor(time * 5),
    vignette: true,
  });
}

function animationLoop(now) {
  if (!state.capturing && ui.compareModal.hidden && now - state.lastFrame > 42) {
    renderLive(now);
    state.lastFrame = now;
  }
  requestAnimationFrame(animationLoop);
}

function showToast(message, warning = false) {
  window.clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.toggle("is-warn", warning);
  ui.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => ui.toast.classList.remove("is-visible"), 2600);
}

function updateProgress() {
  const total = state.shots.length;
  ui.progressText.textContent = `${total} / 3`;
  ui.progressPips.forEach((pip, index) => pip.classList.toggle("is-done", index < total));
  ui.filmHint.textContent = total === 3
    ? "三张曝光达标 · 点击成片可再次比较噪点"
    : `还差 ${3 - total} 张 · 使用三种不同参数达到 0.0 EV ±0.35`;
}

function fillFrame(slot, shot) {
  const frame = ui.frames.querySelector(`[data-slot="${slot}"]`);
  frame.className = "frame is-filled is-new";
  frame.innerHTML = `
    <span class="frame-number">${String(slot + 1).padStart(2, "0")}</span>
    <img src="${shot.image}" alt="第 ${slot + 1} 张夜景成片" />
    <span class="frame-meta">
      <span>${settingsLabel(shot.settings)}</span>
      <strong>${formatSigned(shot.info.ev)} EV</strong>
    </span>
  `;
  window.setTimeout(() => frame.classList.remove("is-new"), 500);
}

function compareCard(shot, index, metrics, role) {
  const noiseMax = Math.max(...metrics.map((metric) => metric.shadowChroma), 1);
  const trailMax = Math.max(...metrics.map((metric) => metric.trail), 1);
  return `
    <article class="compare-card">
      <div class="compare-image">
        <img src="${shot.image}" alt="${role}" />
        <span>FRAME ${String(index + 1).padStart(2, "0")}</span>
        <div class="noise-loupe" style="background-image:url('${shot.loupe}')">
          <small>阴影 2×</small>
        </div>
      </div>
      <div class="compare-card-body">
        <h3>${role}</h3>
        <div class="settings">${settingsLabel(shot.settings)} · ${formatSigned(shot.info.ev)} EV</div>
        <div class="metric-row">
          <span>阴影彩噪</span>
          <div class="metric-track"><i style="width:${Math.max(8, (shot.metrics.shadowChroma / noiseMax) * 100)}%;background:${
            shot.metrics.shadowChroma === Math.max(...metrics.map((metric) => metric.shadowChroma))
              ? "var(--red)"
              : "var(--cyan)"
          }"></i></div>
          <strong>${shot.metrics.shadowChroma.toFixed(1)}</strong>
        </div>
        <div class="metric-row">
          <span>亮度噪点</span>
          <div class="metric-track"><i style="width:${Math.max(8, (shot.metrics.lumaNoise / Math.max(...metrics.map((metric) => metric.lumaNoise), 1)) * 100)}%"></i></div>
          <strong>${shot.metrics.lumaNoise.toFixed(1)}</strong>
        </div>
        <div class="metric-row">
          <span>光轨长度</span>
          <div class="metric-track"><i style="width:${Math.max(4, (shot.metrics.trail / trailMax) * 100)}%;background:var(--amber)"></i></div>
          <strong>${Math.round(shot.metrics.trail)} px</strong>
        </div>
      </div>
    </article>
  `;
}

function openComparison() {
  if (state.shots.length < 3) return;
  const metrics = state.shots.map((shot) => shot.metrics);
  const sortedNoise = [...state.shots].sort((a, b) => a.metrics.shadowChroma - b.metrics.shadowChroma);
  const sortedTrail = [...state.shots].sort((a, b) => b.metrics.trail - a.metrics.trail);
  const roles = new Map();
  roles.set(sortedNoise[0], "低噪基准");
  roles.set(sortedNoise[1], sortedNoise[1] === sortedTrail[0] ? "长曝折中" : "均衡折中");
  roles.set(sortedNoise[2], "高感彩噪");

  ui.compareGrid.innerHTML = state.shots
    .map((shot, index) => compareCard(shot, index, metrics, roles.get(shot)))
    .join("");

  const clean = sortedNoise[0];
  const noisy = sortedNoise[2];
  const ratio = (noisy.metrics.shadowChroma / Math.max(clean.metrics.shadowChroma, 0.1)).toFixed(1);
  const trailShot = sortedTrail[0];
  ui.compareSummary.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4L19 7"/><circle cx="12" cy="12" r="10"/></svg>
    <span>三张均落在目标曝光内。<strong>${settingsLabel(clean.settings)}</strong> 的阴影彩噪为
    <strong>${clean.metrics.shadowChroma.toFixed(1)}</strong>；<strong>${settingsLabel(noisy.settings)}</strong>
    达到 <strong>${noisy.metrics.shadowChroma.toFixed(1)}</strong>，约 <strong>${ratio}×</strong>。
    <strong>${settingsLabel(trailShot.settings)}</strong> 记录到 <strong>${Math.round(trailShot.metrics.trail)} px</strong>
    的移动光轨。</span>
  `;
  ui.filmHint.textContent = "三张曝光达标 · 点击成片可再次比较噪点";
  ui.compareModal.hidden = false;
}

function closeComparison() {
  ui.compareModal.hidden = true;
  state.lastFrame = 0;
}

function addShot(shot) {
  const slot = state.shots.length;
  state.shots.push(shot);
  fillFrame(slot, shot);
  updateProgress();
  if (state.shots.length === 3) {
    ui.filmHint.textContent = "三张曝光达标 · 正在生成噪点对照";
    ui.shutterNote.textContent = "实验完成 · 三张底片已显影";
    window.setTimeout(openComparison, 650);
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function visualExposureDuration(seconds) {
  return Math.min(2.05, 0.72 + Math.log2(seconds * 24 + 1) * 0.22);
}

async function capturePhoto() {
  if (state.capturing || state.shots.length >= 3) return false;
  const settings = currentSettings();
  const info = describeSettings(settings);
  if (!info.inTarget) {
    audio.tick();
    showToast(
      info.ev < 0
        ? `尚未达标：还欠曝 ${Math.abs(info.ev).toFixed(1)} EV`
        : `尚未达标：已过曝 ${info.ev.toFixed(1)} EV`,
      true,
    );
    return false;
  }

  const signature = settingsSignature(settings);
  const duplicateIndex = state.shots.findIndex((shot) => shot.signature === signature);
  if (duplicateIndex >= 0) {
    audio.tick();
    showToast(`与底片 ${String(duplicateIndex + 1).padStart(2, "0")} 参数相同，请换一组曝光`, true);
    return false;
  }

  state.capturing = true;
  updateInterface();
  const frozenTime = (performance.now() - animationStart) / 1000;
  const seed = state.shots.length * 3 + 11;
  scene.render(settings, frozenTime, { noise: true, seed, vignette: true });
  const image = canvas.toDataURL("image/png");
  const loupeCanvas = document.createElement("canvas");
  loupeCanvas.width = 240;
  loupeCanvas.height = 120;
  const loupeContext = loupeCanvas.getContext("2d");
  loupeContext.imageSmoothingEnabled = false;
  loupeContext.drawImage(canvas, 260, 248, 160, 80, 0, 0, 240, 120);
  const loupe = loupeCanvas.toDataURL("image/png");
  const measured = scene.measureNoise(settings, frozenTime, seed);
  const duration = visualExposureDuration(settings.seconds);
  const totalTicks = 4;

  audio.ensureContext();
  audio.shutter();
  ui.shutterCurtain.classList.add("is-closed");
  ui.timerValue.textContent = settings.seconds < 1
    ? settings.seconds.toFixed(settings.seconds < 0.1 ? 3 : 1)
    : settings.seconds.toFixed(1);
  ui.timerProgress.style.strokeDashoffset = "0";
  await wait(105);

  ui.shutterCurtain.classList.remove("is-closed");
  ui.shutterCurtain.classList.add("is-opening");
  ui.timerLayer.classList.add("is-active");
  const startedAt = performance.now();
  const progressTimer = window.setInterval(() => {
    const progress = Math.min(1, (performance.now() - startedAt) / (duration * 1000));
    ui.timerProgress.style.strokeDashoffset = String(326.7 * progress);
  }, 30);
  for (let index = 1; index <= totalTicks; index += 1) {
    window.setTimeout(() => audio.tick(index === totalTicks), (duration * 1000 * index) / totalTicks);
  }

  await wait(duration * 1000);
  window.clearInterval(progressTimer);
  ui.timerProgress.style.strokeDashoffset = "326.7";
  ui.timerLayer.classList.remove("is-active");
  ui.shutterCurtain.classList.remove("is-opening");
  audio.finish();

  const shot = {
    id: state.shots.length + 1,
    settings,
    signature,
    info,
    image,
    loupe,
    metrics: {
      ...measured,
      trail: Math.round(info.trail.pixels),
      iso: settings.iso,
      shutter: settings.seconds,
      aperture: settings.aperture,
    },
  };
  addShot(shot);
  state.capturing = false;
  updateInterface();
  showToast(`底片 ${String(shot.id).padStart(2, "0")} 已记录 · ${formatSigned(info.ev)} EV`);
  return true;
}

function setSetting(key, value) {
  const sliderMap = {
    shutterIndex: ui.shutterSlider,
    isoIndex: ui.isoSlider,
    apertureIndex: ui.apertureSlider,
  };
  const bounds = {
    shutterIndex: SHUTTERS.length - 1,
    isoIndex: ISOS.length - 1,
    apertureIndex: APERTURES.length - 1,
  };
  const next = Math.max(0, Math.min(bounds[key], Number(value)));
  if (!Number.isFinite(next) || state.capturing) return;
  state.settings[key] = next;
  sliderMap[key].value = String(next);
  updateInterface();
}

function resetFrames() {
  ui.frames.innerHTML = [0, 1, 2].map((slot) => `
    <button class="frame is-empty" type="button" data-slot="${slot}" aria-label="底片位 ${slot + 1}">
      <span class="frame-number">${String(slot + 1).padStart(2, "0")}</span><i>+</i><small>待拍摄</small>
    </button>
  `).join("");
}

function restartSession() {
  if (state.capturing) return;
  state.shots = [];
  state.settings = { shutterIndex: 7, isoIndex: 1, apertureIndex: 0 };
  ui.shutterSlider.value = "7";
  ui.isoSlider.value = "1";
  ui.apertureSlider.value = "0";
  resetFrames();
  updateProgress();
  updateInterface();
  closeComparison();
  audio.tick(true);
  showToast("新的曝光实验已开始");
}

ui.shutterSlider.addEventListener("input", (event) => setSetting("shutterIndex", event.target.value));
ui.isoSlider.addEventListener("input", (event) => setSetting("isoIndex", event.target.value));
ui.apertureSlider.addEventListener("input", (event) => setSetting("apertureIndex", event.target.value));
ui.shutterBtn.addEventListener("click", capturePhoto);
ui.audioToggle.addEventListener("click", () => {
  state.soundEnabled = !state.soundEnabled;
  audio.setEnabled(state.soundEnabled);
  ui.audioToggle.classList.toggle("is-off", !state.soundEnabled);
  ui.audioToggle.setAttribute("aria-pressed", String(state.soundEnabled));
  if (state.soundEnabled) audio.tick();
});

ui.frames.addEventListener("click", (event) => {
  const frame = event.target.closest(".frame");
  if (!frame || !frame.classList.contains("is-filled")) return;
  if (state.shots.length === 3) {
    openComparison();
  } else {
    const shot = state.shots[Number(frame.dataset.slot)];
    showToast(`底片 ${String(shot.id).padStart(2, "0")} · ${settingsLabel(shot.settings)} · 阴影彩噪 ${shot.metrics.shadowChroma.toFixed(1)}`);
  }
});

ui.closeCompare.addEventListener("click", closeComparison);
ui.keepShooting.addEventListener("click", closeComparison);
ui.restartSession.addEventListener("click", restartSession);
ui.compareModal.addEventListener("click", (event) => {
  if (event.target === ui.compareModal) closeComparison();
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !event.repeat) {
    event.preventDefault();
    if (!ui.compareModal.hidden) closeComparison();
    else capturePhoto();
  }
  if (event.key === "Escape" && !ui.compareModal.hidden) closeComparison();
});

window.setInterval(() => {
  ui.clock.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });
}, 1000);
ui.clock.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false });

updateProgress();
updateInterface();
requestAnimationFrame(animationLoop);

window.__nightLab = {
  setSettings(settings) {
    for (const key of ["shutterIndex", "isoIndex", "apertureIndex"]) {
      if (key in settings) setSetting(key, settings[key]);
    }
    return currentSettings();
  },
  capture: capturePhoto,
  getState() {
    return {
      settings: currentSettings(),
      shots: state.shots.map((shot) => ({
        id: shot.id,
        settings: shot.settings,
        info: shot.info,
        metrics: shot.metrics,
      })),
      capturing: state.capturing,
    };
  },
  openComparison,
};
