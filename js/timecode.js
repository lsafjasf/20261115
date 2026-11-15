// 核心时间码逻辑：帧号是唯一事实来源，时间码由帧率派生。
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Timecode = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  function pad(num, len) {
    return String(num).padStart(len, "0");
  }

  // 帧号 -> HH:MM:SS:FF（按给定帧率重新计算）
  function frameToTimecode(frame, fps) {
    if (!Number.isInteger(frame) || frame < 0) {
      throw new Error("frame 必须是非负整数");
    }
    const totalSeconds = Math.floor(frame / fps);
    const ff = frame % fps;
    const ss = totalSeconds % 60;
    const mm = Math.floor(totalSeconds / 60) % 60;
    const hh = Math.floor(totalSeconds / 3600);
    return `${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)}:${pad(ff, 2)}`;
  }

  // HH:MM:SS:FF -> 帧号
  function timecodeToFrame(tc, fps) {
    const m = /^(\d{2,}):([0-5]\d):([0-5]\d):(\d{2})$/.exec(tc);
    if (!m) throw new Error(`非法时间码: ${tc}`);
    const [, hh, mm, ss, ff] = m.map(Number);
    if (ff >= fps) throw new Error(`帧位 ${ff} 超出帧率 ${fps}`);
    return ((hh * 60 + mm) * 60 + ss) * fps + ff;
  }

  // 帧号 -> WebVTT 时间戳 HH:MM:SS.mmm（毫秒按帧率换算）
  function frameToVttTimestamp(frame, fps) {
    const totalMs = Math.round((frame / fps) * 1000);
    const ms = totalMs % 1000;
    const totalSeconds = Math.floor(totalMs / 1000);
    const ss = totalSeconds % 60;
    const mm = Math.floor(totalSeconds / 60) % 60;
    const hh = Math.floor(totalSeconds / 3600);
    return `${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)}.${pad(ms, 3)}`;
  }

  // 区间 [in, out) 半开区间重叠检测，返回冲突对列表
  function findOverlaps(cues) {
    const sorted = [...cues].sort((a, b) => a.inFrame - b.inFrame);
    const conflicts = [];
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (b.inFrame >= a.outFrame) break;
        conflicts.push([a.id, b.id]);
      }
    }
    return conflicts;
  }

  function validateCues(cues) {
    const errors = [];
    for (const cue of cues) {
      if (!Number.isInteger(cue.inFrame) || !Number.isInteger(cue.outFrame)) {
        errors.push(`字幕 ${cue.id}: 入点/出点必须是整数帧`);
      } else if (cue.inFrame >= cue.outFrame) {
        errors.push(`字幕 ${cue.id}: 入点必须小于出点`);
      }
      if (!cue.text || !cue.text.trim()) {
        errors.push(`字幕 ${cue.id}: 文本不能为空`);
      }
    }
    for (const [a, b] of findOverlaps(cues)) {
      errors.push(`字幕 ${a} 与 ${b} 时间重叠，无法保存`);
    }
    return errors;
  }

  function toWebVtt(cues, fps) {
    const errors = validateCues(cues);
    if (errors.length) throw new Error(errors.join("\n"));
    const sorted = [...cues].sort((a, b) => a.inFrame - b.inFrame);
    const body = sorted
      .map(
        (cue, i) =>
          `${i + 1}\n${frameToVttTimestamp(cue.inFrame, fps)} --> ${frameToVttTimestamp(
            cue.outFrame,
            fps
          )}\n${cue.text.trim()}`
      )
      .join("\n\n");
    return `WEBVTT\n\n${body}\n`;
  }

  return {
    frameToTimecode,
    timecodeToFrame,
    frameToVttTimestamp,
    findOverlaps,
    validateCues,
    toWebVtt,
  };
});
