// 工程数据模型与全部编辑操作。时间一律使用整数毫秒，避免浮点误差。
const { ValidationError } = require('./errors');

let NEXT_ID = 1;

function nextId() {
  const id = NEXT_ID;
  NEXT_ID += 1;
  return id;
}

function isIntMs(value) {
  return Number.isInteger(value);
}

function cloneCue(cue) {
  return { id: cue.id, start: cue.start, end: cue.end, text: cue.text };
}

class Project {
  constructor(durationMs = 20000, cues = []) {
    if (!Number.isInteger(durationMs) || durationMs <= 0) {
      throw new ValidationError('BAD_DURATION', '视频时长必须是正整数毫秒');
    }
    this.durationMs = durationMs;
    this.cues = cues.map(cloneCue);
  }

  sortedCues() {
    return [...this.cues].sort((a, b) => a.start - b.start || a.end - b.end);
  }

  getCue(id) {
    const cue = this.cues.find((item) => item.id === id);
    if (!cue) throw new ValidationError('NOT_FOUND', `字幕 ${id} 不存在`);
    return cue;
  }

  // 对一组候选字幕做完整校验：范围、零长度、重叠。
  validate(candidates) {
    // 同 id 候选项以最后一次出现为准（更新场景会先放旧值再放新值）。
    const deduped = new Map();
    for (const candidate of candidates) {
      deduped.set(candidate.id, cloneCue(candidate));
    }
    const list = [...deduped.values()];
    for (const cue of list) {
      if (!isIntMs(cue.start) || !isIntMs(cue.end)) {
        throw new ValidationError('BAD_TIME', `字幕 ${cue.id} 的时间点必须是整数毫秒`);
      }
      if (cue.start < 0 || cue.end > this.durationMs) {
        throw new ValidationError(
          'OUT_OF_RANGE',
          `字幕 ${cue.id} 超出视频范围 [0, ${this.durationMs}]ms`
        );
      }
      if (cue.end <= cue.start) {
        throw new ValidationError(
          'ZERO_LENGTH',
          `字幕 ${cue.id} 出点必须晚于入点（当前 ${cue.start} -> ${cue.end}）`
        );
      }
      if (typeof cue.text !== 'string') {
        throw new ValidationError('BAD_TEXT', `字幕 ${cue.id} 文本必须是字符串`);
      }
    }
    const ordered = [...list].sort((a, b) => a.start - b.start);
    for (let i = 1; i < ordered.length; i += 1) {
      if (ordered[i].start < ordered[i - 1].end) {
        throw new ValidationError(
          'OVERLAP',
          `字幕 ${ordered[i - 1].id} 与 ${ordered[i].id} 时间重叠`
        );
      }
    }
    return true;
  }

  addCue(start, end, text) {
    return this.insertCue({ id: nextId(), start, end, text });
  }

  insertCue(cue) {
    this.validate([...this.cues, cue]);
    this.cues.push(cloneCue(cue));
    return cloneCue(cue);
  }

  updateCue(id, patch) {
    const cue = this.getCue(id);
    const merged = {
      id: cue.id,
      start: patch.start ?? cue.start,
      end: patch.end ?? cue.end,
      text: patch.text ?? cue.text,
    };
    this.validate(this.cues.map((item) => (item.id === id ? merged : item)));
    cue.start = merged.start;
    cue.end = merged.end;
    cue.text = merged.text;
    return cloneCue(cue);
  }

  removeCue(id) {
    const index = this.cues.findIndex((item) => item.id === id);
    if (index === -1) throw new ValidationError('NOT_FOUND', `字幕 ${id} 不存在`);
    const [removed] = this.cues.splice(index, 1);
    return cloneCue(removed);
  }

  // 在 splitAtMs 处断句：原字幕保留前半句，新建一条承接后半句。
  splitCue(id, splitAtMs) {
    const cue = this.getCue(id);
    if (!isIntMs(splitAtMs) || splitAtMs <= cue.start || splitAtMs >= cue.end) {
      throw new ValidationError(
        'BAD_SPLIT',
        `断句点必须严格位于字幕 ${id} 的入点与出点之间`
      );
    }
    const left = { ...cue, end: splitAtMs };
    const right = { id: nextId(), start: splitAtMs, end: cue.end, text: cue.text };
    this.validate(this.cues.map((item) => (item.id === id ? left : item)).concat(right));
    cue.end = splitAtMs;
    this.cues.push(cloneCue(right));
    return { left: cloneCue(left), right: cloneCue(right) };
  }

  // 合并相邻（允许首尾相接）的两条字幕，时间跨度取并集。
  mergeCues(firstId, secondId) {
    const first = this.getCue(firstId);
    const second = this.getCue(secondId);
    const [earlier, later] = first.start <= second.start ? [first, second] : [second, first];
    if (later.start < earlier.end) {
      throw new ValidationError('OVERLAP', '只有相邻且不重叠的字幕才能合并');
    }
    const merged = {
      id: earlier.id,
      start: earlier.start,
      end: later.end,
      text: `${earlier.text} ${later.text}`.trim(),
    };
    const rest = this.cues.filter((item) => item.id !== firstId && item.id !== secondId);
    this.validate([...rest, merged]);
    this.cues = rest;
    this.cues.push(merged);
    return cloneCue(merged);
  }

  // 播放头位置当前应显示的字幕（严格按 [start, end) 命中）。
  activeCueAt(timeMs) {
    return this.cues.find((cue) => timeMs >= cue.start && timeMs < cue.end) || null;
  }

  toJSON() {
    return {
      format: 'subtitle-studio-project',
      version: 1,
      durationMs: this.durationMs,
      cues: this.sortedCues().map(cloneCue),
    };
  }

  static fromJSON(data) {
    if (!data || data.format !== 'subtitle-studio-project' || data.version !== 1) {
      throw new ValidationError('BAD_PROJECT', '工程 JSON 格式或版本不被支持');
    }
    const project = new Project(data.durationMs);
    for (const cue of data.cues) {
      project.insertCue(cloneCue(cue));
    }
    NEXT_ID = Math.max(NEXT_ID - 1, ...data.cues.map((cue) => cue.id)) + 1;
    return project;
  }
}

module.exports = { Project, ValidationError };
