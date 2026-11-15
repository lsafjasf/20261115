import {
  DEFAULT_BPM,
  MASKING_THRESHOLD,
  MAX_BPM,
  MIN_BPM,
  TOTAL_STEPS,
} from "./constants.js";
import { Clock } from "./clock.js";
import { AudioEngine } from "./audio.js";
import { MechanismView } from "./mechanism.js";
import { ScoreEditor } from "./score.js";
import { SongStore } from "./storage.js";
import { buildDemoSong } from "./demo.js";
import { LEFT_TINES, RIGHT_TINES } from "./notes.js";
import {
  fromMidiJSON,
  notesAtStep,
  toMidiJSON,
} from "./song.js";

const $ = (sel) => document.querySelector(sel);

class App {
  constructor() {
    this.store = new SongStore();
    this.audio = new AudioEngine();
    this.clock = new Clock(DEFAULT_BPM);
    this.selected = { midi: 74, duration: 2 };
    this.savedSnapshot = null;
    this._initSong();
  }

  _initSong() {
    const stored = this.store.load();
    this.song = stored ? stored.snapshot : buildDemoSong();
    this.savedSnapshot = stored ? JSON.stringify(this.song) : null;
    this.clock = new Clock(this.song.bpm || DEFAULT_BPM);
  }

  boot() {
    this._buildPlates();
    this.mechanism = new MechanismView($("#mechanism"));
    this.editor = new ScoreEditor($("#score-grid"), this.song, {
      onPick: () => this.selected,
      onChange: () => this._onEdit(),
    });
    this.editor.render();
    this._wireControls();
    this._renderMeta();
    this._renderSaveState();
    this.audio.onResonance = (count, masked) => this._renderResonance(count, masked);
    this._lastFrame = null;
    requestAnimationFrame((t) => this._loop(t));
  }

  _buildPlates() {
    const mk = (root, tines, track) => {
      for (const t of tines) {
        const btn = document.createElement("button");
        btn.className = "plate" + (t.midi === this.selected.midi ? " selected" : "");
        btn.draggable = true;
        btn.dataset.midi = t.midi;
        btn.innerHTML = `<strong>${t.name}</strong><small>${t.midi}</small>`;
        btn.addEventListener("click", () => this._selectPlate(t.midi, btn));
        btn.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/tine-midi", String(t.midi));
          e.dataTransfer.effectAllowed = "copy";
          this._selectPlate(t.midi, btn);
        });
        root.appendChild(btn);
      }
      root.dataset.track = track;
    };
    mk($("#plates-left"), LEFT_TINES, "left");
    mk($("#plates-right"), RIGHT_TINES, "right");
  }

  _selectPlate(midi, btn) {
    this.selected.midi = midi;
    document.querySelectorAll(".plate").forEach((p) => p.classList.remove("selected"));
    btn.classList.add("selected");
    this.audio.ensure();
    this.audio.pluck(midi, 1);
  }

  _wireControls() {
    $("#play").addEventListener("click", () => this._togglePlay());
    $("#stop").addEventListener("click", () => this._stop());
    $("#loop").addEventListener("click", () => {
      this.clock.loop = !this.clock.loop;
      $("#loop").classList.toggle("off", !this.clock.loop);
    });
    const bpm = $("#bpm");
    bpm.min = MIN_BPM;
    bpm.max = MAX_BPM;
    bpm.value = this.song.bpm;
    $("#bpm-value").textContent = `${this.song.bpm} BPM`;
    bpm.addEventListener("input", () => {
      const v = Number(bpm.value);
      this.song.bpm = v;
      this.clock.setBpm(v);
      $("#bpm-value").textContent = `${v} BPM`;
      $("#bpm-card").textContent = `${v} BPM`;
      this._onEdit();
    });
    $("#duration").addEventListener("change", (e) => {
      this.selected.duration = Number(e.target.value);
    });
    $("#save").addEventListener("click", () => this._save());
    $("#restore").addEventListener("click", () => this._restore());
    $("#export").addEventListener("click", () => this._export());
    $("#import").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", (e) => this._import(e.target.files[0]));
    $("#clear").addEventListener("click", () => {
      this.song.notes = [];
      this.editor.render();
      this._onEdit();
    });
    $("#load-demo").addEventListener("click", () => {
      this.song = buildDemoSong();
      this.editor.song = this.song;
      this.clock.setBpm(this.song.bpm);
      $("#bpm").value = this.song.bpm;
      $("#bpm-value").textContent = `${this.song.bpm} BPM`;
      this.editor.render();
      this._renderMeta();
      this._onEdit();
    });
    document.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
        e.preventDefault();
        this._togglePlay();
      }
    });
  }

  _togglePlay() {
    this.audio.ensure();
    if (this.clock.playing) {
      this.clock.pause();
    } else {
      if (this.clock.step >= TOTAL_STEPS) this.clock.seek(0);
      this.clock.start();
      this.audio.resume();
      const step = this.clock.currentStep();
      if (notesAtStep(this.song, step).length) this._fireStep(step);
    }
    this._renderTransport();
  }

  _stop() {
    this.clock.stop();
    this.mechanism.clearVibration();
    this.editor.setPlayhead(-1);
    this._renderTransport();
    this._renderPosition(0);
  }

  _loop() {
    const now = performance.now();
    if (this._lastFrame === null) this._lastFrame = now;
    const dt = Math.min(0.05, Math.max(0, (now - this._lastFrame) / 1000));
    this._lastFrame = now;
    const crossed = this.clock.advance(dt);
    for (const step of crossed) this._fireStep(step);
    const floatStep = this.clock.step;
    this.mechanism.draw(this.song, floatStep, this.clock.playing, this.clock.bpm);
    if (crossed.length) {
      this.editor.setPlayhead(this.clock.currentStep());
      this._renderPosition(this.clock.currentStep());
    }
    if (!this.clock.playing && this.clock.step >= TOTAL_STEPS) this._renderTransport();
    requestAnimationFrame((t) => this._loop(t));
  }

  _fireStep(step) {
    const hits = notesAtStep(this.song, step);
    const simultaneous = hits.length;
    for (const n of hits) {
      this.audio.pluck(n.midi, simultaneous);
      this.mechanism.trigger(n.midi, simultaneous > MASKING_THRESHOLD);
    }
    if (hits.length) {
      const ringing = this.audio.resonanceCount(this.audio.now);
      const masked = simultaneous > MASKING_THRESHOLD;
      this._renderResonance(ringing, masked);
    }
  }

  _renderResonance(count, masked) {
    const el = $("#resonance-count");
    el.textContent = String(count).padStart(2, "0");
    const state = $("#resonance-state");
    const bars = $("#resonance-bars");
    bars.innerHTML = "";
    for (let i = 0; i < 8; i++) {
      const b = document.createElement("i");
      b.style.height = `${i < count ? 30 + Math.random() * 60 : 12}%`;
      if (i >= MASKING_THRESHOLD) b.classList.add("danger");
      bars.appendChild(b);
    }
    if (count === 0) {
      state.textContent = "安静待命";
      state.className = "state calm";
    } else if (masked) {
      state.textContent = "齿片掩蔽";
      state.className = "state mask";
      $("#resonance-hint").textContent =
        `${count} 根齿片同时振动，响度已被自动收束，建议留出更长的拍间空隙。`;
    } else {
      state.textContent = "清脆共鸣";
      state.className = "state ring";
      $("#resonance-hint").textContent =
        "同时振动的齿片越多，声音越拥挤。发条转快时，注意留出呼吸。";
    }
  }

  _renderPosition(step) {
    const bar = Math.floor(step / 16) + 1;
    const beat = (step % 16) / 4 + 1;
    $("#position").textContent = `小节 ${String(bar).padStart(2, "0")} · 拍 ${beat.toFixed(0)}`;
  }

  _renderTransport() {
    $("#play").textContent = this.clock.playing ? "❚❚" : "▶";
    $("#play").classList.toggle("is-playing", this.clock.playing);
  }

  _renderMeta() {
    $("#meta-title").textContent = this.song.title;
    $("#meta-title-en").textContent = `${this.song.titleEn} · Original`;
    $("#meta-key").textContent = this.song.key;
    $("#note-count").textContent = `${this.song.notes.length} 个音符`;
  }

  _onEdit() {
    $("#note-count").textContent = `${this.song.notes.length} 个音符`;
    const dirty = this.savedSnapshot !== null && JSON.stringify(this.song) !== this.savedSnapshot;
    const dot = $("#save-dot");
    dot.className = dirty ? "dot dirty" : "dot saved";
    $("#save-text").textContent =
      dirty ? "有未保存的修改" : this.savedSnapshot === null ? "示例曲目" : "已保存";
  }

  _renderSaveState() {
    this._onEdit();
  }

  _save() {
    this.savedSnapshot = JSON.stringify(this.song);
    this.store.save(this.song);
    this._onEdit();
    this._toast(`已保存 ${this.song.notes.length} 个音符到浏览器本地`);
  }

  _restore() {
    const stored = this.store.load();
    if (!stored) {
      this._toast("还没有可恢复的保存快照");
      return;
    }
    this.song = stored.snapshot;
    this.savedSnapshot = JSON.stringify(this.song);
    this.editor.song = this.song;
    this.clock.setBpm(this.song.bpm || DEFAULT_BPM);
    $("#bpm").value = this.song.bpm || DEFAULT_BPM;
    $("#bpm-value").textContent = `${this.song.bpm || DEFAULT_BPM} BPM`;
    this.editor.render();
    this._renderMeta();
    this._onEdit();
    this._toast("已恢复上次保存的谱面");
  }

  _export() {
    const data = toMidiJSON(this.song);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.song.titleEn.replace(/\s+/g, "-").toLowerCase()}.midi.json`;
    a.click();
    URL.revokeObjectURL(url);
    this._toast("已导出 MIDI 风格 JSON");
  }

  _import(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const song = fromMidiJSON(JSON.parse(reader.result));
        song.title = this.song.title;
        this.song = song;
        this.editor.song = song;
        this.clock.setBpm(song.bpm || DEFAULT_BPM);
        $("#bpm").value = song.bpm || DEFAULT_BPM;
        $("#bpm-value").textContent = `${song.bpm || DEFAULT_BPM} BPM`;
        this.editor.render();
        this._renderMeta();
        this._onEdit();
        this._toast(`已载入 ${song.notes.length} 个音符`);
      } catch (err) {
        this._toast(err.message);
      }
    };
    reader.readAsText(file);
  }

  _toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.__app = new App();
  window.__app.boot();
});
