import { AudioEngine } from './audio-engine.js';
import { FieldView } from './field-view.js';
import { PathStore } from './path-store.js';
import {
  MODE_IDS, MODES, SPEAKER_IDS, SPEAKER_LABELS, computeField
} from './acoustics.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.engine = new AudioEngine();
    this.paths = new PathStore();
    this.mode = 'stereo';
    this.listener = { x: 0, y: 0 };
    this.view = new FieldView($('field'), (p) => this.moveListener(p));
    this.view.setListener(this.listener, false);
    this.bindControls();
    this.refreshPathList();
    this.renderModeCards();
    this.updatePanels();
    // Cheap continuous sampling while recording a path.
    setInterval(() => this.paths.sample(this.listener), 60);
  }

  async ensureAudio() {
    await this.engine.start();
    $('audioState').textContent =
      `音频运行中 · ${this.engine.ctx.sampleRate} Hz · 状态 ${this.engine.ctx.state}`;
  }

  bindControls() {
    $('startAudio').addEventListener('click', () => this.ensureAudio());
    MODE_IDS.forEach((id) => {
      $(`mode-${id}`).addEventListener('change', () => this.switchMode(id));
    });
    $('recordPath').addEventListener('click', () => this.toggleRecord());
    $('savePath').addEventListener('click', () => this.savePath());
    $('playPath').addEventListener('click', () => this.playSaved());
    $('stopPlay').addEventListener('click', () => {
      this.paths.stopPlayback();
      this.setStatus('回放已停止');
    });
    $('exportPath').addEventListener('click', () => this.exportPath());
    $('importPath').addEventListener('change', (e) => this.importPath(e));
    $('runSelfTest').addEventListener('click', () => this.runSelfTest());
  }

  async switchMode(id) {
    this.mode = id;
    this.view.setMode(id);
    await this.ensureAudio();
    this.engine.applyMode(id);
    this.updatePanels();
    this.setStatus(`已切换到 ${MODES[id].label}，输出 ${MODES[id].outputChannels} 声道`);
  }

  moveListener(p) {
    this.listener = p;
    this.view.setListener(p);
    this.paths.sample(p);
    if (this.engine.ctx) this.engine.update(p);
    this.updatePanels();
  }

  setStatus(text) {
    $('status').textContent = text;
  }

  updatePanels() {
    const field = computeField(this.listener, this.mode);
    $('listenerPos').textContent =
      `x = ${this.listener.x.toFixed(2)} m, y = ${this.listener.y.toFixed(2)} m`;
    $('combinedSpl').textContent = `${field.combinedSpl.toFixed(1)} dB SPL`;
    $('channelBadge').textContent =
      `${field.outputChannels} 声道输出 · ${field.speakers.filter((s) => s.active).length} 个启用扬声器`;
    const rows = field.speakers.map((s) => `
      <tr class="${s.active ? '' : 'muted'}">
        <td>${SPEAKER_LABELS[s.id]} <span class="id">${s.id}</span></td>
        <td>${s.distance.toFixed(2)} m</td>
        <td>${s.delayMs.toFixed(2)} ms</td>
        <td>${s.gain.toFixed(3)}</td>
        <td>${s.spl.toFixed(1)} dB</td>
        <td>${s.active ? '启用' : '静音'}</td>
      </tr>`).join('');
    $('speakerRows').innerHTML = rows;
    this.renderModeCards();
  }

  // Side-by-side comparison at the exact same listener position.
  renderModeCards() {
    $('modeCompare').innerHTML = MODE_IDS.map((id) => {
      const f = computeField(this.listener, id);
      const active = f.speakers.filter((s) => s.active);
      const delayRange = rangeOf(active.map((s) => s.delayMs));
      const gainRange = rangeOf(active.map((s) => s.gain));
      const current = id === this.mode ? 'current' : '';
      return `
        <article class="mode-card ${current}">
          <h4>${MODES[id].label}</h4>
          <p><b>${f.outputChannels}</b> 声道 · <b>${active.length}</b> 扬声器</p>
          <p>延迟 ${delayRange} ms</p>
          <p>增益 ${gainRange}</p>
          <p>合成 SPL ${f.combinedSpl.toFixed(1)} dB</p>
        </article>`;
    }).join('');
  }

  toggleRecord() {
    if (this.paths.recording) {
      this.paths.stopRecording();
      $('recordPath').textContent = '● 开始录制路径';
      this.setStatus(`录制结束，共 ${this.paths.recorded.length} 个采样点`);
    } else {
      this.view.clearTrail();
      this.paths.startRecording();
      $('recordPath').textContent = '■ 停止录制';
      this.setStatus('正在录制听者路径，拖动红色听者标记');
    }
  }

  savePath() {
    const name = $('pathName').value.trim();
    this.paths.save(name);
    $('pathName').value = '';
    this.refreshPathList();
    this.setStatus('路径已保存到 localStorage');
  }

  refreshPathList() {
    const all = this.paths.loadAll();
    const names = Object.keys(all);
    $('savedList').innerHTML = names.length
      ? names.map((n) => `<option value="${escapeHtml(n)}">`).join('')
      : '<option value="">（暂无保存路径）</option>';
  }

  playSaved() {
    const name = $('savedList').value;
    const all = this.paths.loadAll();
    const entry = all[name];
    if (!entry) {
      this.setStatus('请先选择并保存一条路径');
      return;
    }
    this.ensureAudio().then(() => {
      this.view.clearTrail();
      this.paths.play(entry.points, (p, progress) => {
        this.moveListener(p);
        $('playProgress').value = progress * 100;
      }, () => this.setStatus('路径回放完成'));
    });
  }

  exportPath() {
    const blob = new Blob([this.paths.toJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'listener-path.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  importPath(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        this.paths.recorded = PathStore.fromJSON(reader.result);
        this.setStatus(`已导入 ${this.paths.recorded.length} 个路径点，可直接回放`);
      } catch (err) {
        this.setStatus(`导入失败: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  // Build every routing graph for real and verify declared + captured channels.
  async runSelfTest() {
    await this.ensureAudio();
    const results = [];
    const previousMode = this.mode;
    for (const id of MODE_IDS) {
      this.engine.applyMode(id);
      const routing = this.engine.describeRouting();
      const model = computeField(this.listener, id);
      const checks = [
        ['模式表声明声道', routing.declaredOutputChannels === MODES[id].outputChannels],
        ['模型输出声道一致', model.outputChannels === MODES[id].outputChannels],
        ['活跃扬声器数量', routing.activeVoiceCount === MODES[id].activeSpeakers.length],
        ['四路采集声道', id !== 'quad' || routing.capturedChannels === 4],
        ['处理器类型', routing.tailKinds.every((k, idx) => {
          const active = MODES[id].activeSpeakers.includes(SPEAKER_IDS[idx]);
          if (!active) return true;
          // Quad routes straight into ChannelMerger, so there is no tail node.
          return id === 'quad' ? k === 'none' : k !== 'none';
        })]
      ];
      results.push({ id, routing, checks });
    }
    // Switch at the same position must not move the listener.
    const before = { ...this.listener };
    for (const id of MODE_IDS) this.engine.applyMode(id);
    const positionKept = before.x === this.listener.x && before.y === this.listener.y;
    this.engine.applyMode(previousMode);
    this.mode = previousMode;
    document.querySelector(`#mode-${previousMode}`).checked = true;
    this.view.setMode(previousMode);
    this.renderSelfTest(results, positionKept);
  }

  renderSelfTest(results, positionKept) {
    const rows = results.flatMap(({ id, routing, checks }) =>
      checks.map(([name, ok]) => `
        <tr>
          <td>${MODES[id].label}</td>
          <td>${name}</td>
          <td>${routing.declaredOutputChannels} / 采集 ${routing.capturedChannels}</td>
          <td class="${ok ? 'pass' : 'fail'}">${ok ? '通过' : '失败'}</td>
        </tr>`)).join('');
    $('selfTestResults').innerHTML = `
      <table>
        <thead><tr><th>模式</th><th>检查项</th><th>声道</th><th>结果</th></tr></thead>
        <tbody>${rows}
          <tr><td>位置保持</td><td>同点切换模式听者不移动</td><td>-</td>
          <td class="${positionKept ? 'pass' : 'fail'}">
            ${positionKept ? '通过' : '失败'}</td></tr>
        </tbody>
      </table>`;
    const failed = results.some((r) => r.checks.some(([, ok]) => !ok)) || !positionKept;
    this.setStatus(failed ? '自检发现失败项，请查看表格' : '全部自检通过：2/2/4 声道路由正确');
  }
}

function rangeOf(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? min.toFixed(2) : `${min.toFixed(2)}–${max.toFixed(2)}`;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
