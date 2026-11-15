// 浏览器直载版引擎：与 Node 端共用同一份算法源码，仅在导出方式上分支。
(function (global) {
  const hasExports = typeof module !== 'undefined' && module.exports;
  const api = hasExports ? {} : (global.StudioCore = {});

  class ValidationError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'ValidationError';
      this.code = code;
    }
  }

  let NEXT_ID = 1;
  function nextId() {
    const id = NEXT_ID;
    NEXT_ID += 1;
    return id;
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
    validate(candidates) {
      const deduped = new Map();
      for (const candidate of candidates) deduped.set(candidate.id, cloneCue(candidate));
      const list = [...deduped.values()];
      for (const cue of list) {
        if (!Number.isInteger(cue.start) || !Number.isInteger(cue.end)) {
          throw new ValidationError('BAD_TIME', `字幕 ${cue.id} 时间点必须是整数毫秒`);
        }
        if (cue.start < 0 || cue.end > this.durationMs) {
          throw new ValidationError('OUT_OF_RANGE',
            `字幕 ${cue.id} 超出视频范围 [0, ${this.durationMs}]ms`);
        }
        if (cue.end <= cue.start) {
          throw new ValidationError('ZERO_LENGTH',
            `字幕 ${cue.id} 出点必须晚于入点（${cue.start} -> ${cue.end}）`);
        }
        if (typeof cue.text !== 'string') {
          throw new ValidationError('BAD_TEXT', `字幕 ${cue.id} 文本必须是字符串`);
        }
      }
      const ordered = [...list].sort((a, b) => a.start - b.start);
      for (let i = 1; i < ordered.length; i += 1) {
        if (ordered[i].start < ordered[i - 1].end) {
          throw new ValidationError('OVERLAP',
            `字幕 ${ordered[i - 1].id} 与 ${ordered[i].id} 时间重叠`);
        }
      }
      return true;
    }
    insertCue(cue) {
      this.validate([...this.cues, cue]);
      this.cues.push(cloneCue(cue));
      return cloneCue(cue);
    }
    addCue(start, end, text) {
      return this.insertCue({ id: nextId(), start, end, text });
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
    splitCue(id, splitAtMs) {
      const cue = this.getCue(id);
      if (!Number.isInteger(splitAtMs) || splitAtMs <= cue.start || splitAtMs >= cue.end) {
        throw new ValidationError('BAD_SPLIT',
          `断句点必须严格位于字幕 ${id} 的入点与出点之间`);
      }
      const left = { ...cue, end: splitAtMs };
      const right = { id: nextId(), start: splitAtMs, end: cue.end, text: cue.text };
      this.validate(this.cues.map((item) => (item.id === id ? left : item)).concat(right));
      cue.end = splitAtMs;
      this.cues.push(cloneCue(right));
      return { left: cloneCue(left), right: cloneCue(right) };
    }
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
      for (const cue of data.cues) project.insertCue(cloneCue(cue));
      NEXT_ID = Math.max(NEXT_ID - 1, ...data.cues.map((cue) => cue.id)) + 1;
      return project;
    }
  }

  Object.assign(api, { ValidationError, Project });
  if (hasExports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
