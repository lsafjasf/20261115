import { TOTAL_STEPS, STEPS_PER_BAR, BARS } from "./constants.js";
import { hasConflict, removeNote } from "./song.js";
import { midiToName, trackOf } from "./notes.js";

const LEFT = "left";
const RIGHT = "right";

// 八小节可编辑谱面：DOM 网格，支持音片库拖放、点选后落音、双击移除与拖动移位。
export class ScoreEditor {
  constructor(root, song, { onPick, onChange }) {
    this.root = root;
    this.song = song;
    this.onPick = onPick; // () => { midi, duration } | null
    this.onChange = onChange;
    this.dragMidi = null;
    this.dragNoteId = null;
    this._build();
  }

  _build() {
    this.root.innerHTML = "";
    for (const track of [LEFT, RIGHT]) {
      const lane = document.createElement("div");
      lane.className = `lane lane-${track}`;
      lane.dataset.track = track;
      const label = document.createElement("div");
      label.className = "lane-label";
      label.innerHTML = track === LEFT
        ? `<span class="lane-badge badge-left">L</span><strong>左轨</strong><small>LOW · C3 – E4</small>`
        : `<span class="lane-badge badge-right">R</span><strong>右轨</strong><small>HIGH · G4 – E6</small>`;
      const grid = document.createElement("div");
      grid.className = "grid";
      for (let bar = 0; bar < BARS; bar++) {
        const barEl = document.createElement("div");
        barEl.className = "bar";
        const tag = document.createElement("span");
        tag.className = "bar-tag";
        tag.textContent = `BAR ${String(bar + 1).padStart(2, "0")}`;
        barEl.appendChild(tag);
        const cells = document.createElement("div");
        cells.className = "cells";
        for (let s = 0; s < STEPS_PER_BAR; s++) {
          const step = bar * STEPS_PER_BAR + s;
          const cell = document.createElement("div");
          cell.className = "cell" + (s % 4 === 0 ? " beat" : "");
          cell.dataset.step = step;
          cell.dataset.track = track;
          this._wireCell(cell);
          cells.appendChild(cell);
        }
        barEl.appendChild(cells);
        grid.appendChild(barEl);
      }
      lane.append(label, grid);
      this.root.appendChild(lane);
    }
  }

  _wireCell(cell) {
    cell.addEventListener("dragover", (e) => {
      e.preventDefault();
      cell.classList.add("drop-hot");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("drop-hot"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("drop-hot");
      const midi = Number(e.dataTransfer.getData("text/tine-midi"));
      const noteId = e.dataTransfer.getData("text/tine-note");
      if (noteId) this._moveNote(noteId, Number(cell.dataset.step), cell.dataset.track);
      else if (midi) this._place(Number(cell.dataset.step), cell.dataset.track, midi, 2);
    });
    cell.addEventListener("click", () => {
      const pick = this.onPick();
      if (!pick) return;
      this._place(Number(cell.dataset.step), cell.dataset.track, pick.midi, pick.duration);
    });
  }

  _place(step, track, midi, duration) {
    if (trackOf(midi) !== track) return; // 音片只能落在对应的齿排轨
    const note = { step, duration, midi, track };
    if (hasConflict(this.song, note)) {
      this._flash(step, track, "conflict");
      return;
    }
    this.song.notes.push({
      id: `n_${Date.now()}_${step}_${midi}`,
      step,
      midi,
      duration,
      track,
    });
    this.render();
    this.onChange();
  }

  _flash(step, track, cls) {
    const cell = this.root.querySelector(`.cell[data-step="${step}"][data-track="${track}"]`);
    if (!cell) return;
    cell.classList.add(cls);
    setTimeout(() => cell.classList.remove(cls), 350);
  }

  _moveNote(id, step, track) {
    const note = this.song.notes.find((n) => n.id === id);
    if (!note || note.track !== track) return;
    if (
      hasConflict(this.song, {
        step,
        duration: note.duration,
        track,
        midi: note.midi,
        ignoreId: id,
      })
    ) {
      this._flash(step, track, "conflict");
      return;
    }
    note.step = step;
    this.render();
    this.onChange();
  }

  render() {
    for (const el of this.root.querySelectorAll(".note-chip")) el.remove();
    for (const n of this.song.notes) {
      const host = this.root.querySelector(
        `.cell[data-step="${n.step}"][data-track="${n.track}"]`,
      );
      if (!host) continue;
      const chip = document.createElement("div");
      chip.className = `note-chip chip-${n.track}`;
      chip.draggable = true;
      chip.dataset.id = n.id;
      chip.style.width = `${n.duration * 100}%`;
      chip.innerHTML = `<span>${midiToName(n.midi)}</span><small>${n.duration === 4 ? "♩" : "♪"}</small>`;
      chip.title = `${midiToName(n.midi)} · 第 ${Math.floor(n.step / 16) + 1} 小节`;
      chip.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        removeNote(this.song, n.id);
        this.render();
        this.onChange();
      });
      chip.addEventListener("dragstart", (e) => {
        this.dragNoteId = n.id;
        e.dataTransfer.setData("text/tine-note", n.id);
        e.dataTransfer.effectAllowed = "move";
      });
      chip.addEventListener("dragend", () => {
        this.dragNoteId = null;
        this.root.querySelectorAll(".drop-hot").forEach((x) => x.classList.remove("drop-hot"));
      });
      host.appendChild(chip);
    }
  }

  // 高亮当前播放步
  setPlayhead(step) {
    const prev = this.root.querySelector(".cell.playing");
    if (prev) prev.classList.remove("playing");
    if (step < 0 || step >= TOTAL_STEPS) return;
    for (const track of [LEFT, RIGHT]) {
      const cell = this.root.querySelector(`.cell[data-step="${step}"][data-track="${track}"]`);
      if (cell) cell.classList.add("playing");
    }
  }
}
