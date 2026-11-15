import { DURATION } from "./model.js";
import { drawPoster } from "./renderer.js";

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

function pickMimeType() {
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function exportLoop({
  canvas,
  project,
  audio,
  onProgress = () => {},
  onFrame = () => {},
}) {
  let recorder = null;
  let animationFrame = 0;
  let cancelled = false;
  let timeoutId = 0;

  const promise = (async () => {
    const audioContext = await audio.ensure();
    const mimeType = pickMimeType();
    if (!mimeType) throw new Error("浏览器不支持 WebM 录制");
    if (typeof canvas.captureStream !== "function") {
      throw new Error("浏览器不支持 Canvas 视频流");
    }

    const videoStream = canvas.captureStream(30);
    const audioStream = audio.getStream();
    if (!audioStream.getAudioTracks().length) {
      throw new Error("音频轨道未就绪，已取消导出");
    }

    const mixedStream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioStream.getAudioTracks(),
    ]);

    recorder = new MediaRecorder(mixedStream, {
      mimeType,
      videoBitsPerSecond: 9_000_000,
      audioBitsPerSecond: 192_000,
    });
    const chunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) chunks.push(event.data);
    });

    drawPoster(canvas, project, 0);
    const startCtxTime = audioContext.currentTime + 0.05;
    const startPerfTime = performance.now() + 50;
    audio.scheduleExport(startCtxTime);
    recorder.start(250);

    const complete = new Promise((resolve, reject) => {
      recorder.addEventListener("stop", () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        mixedStream.getTracks().forEach((track) => track.stop());
        resolve({
          blob,
          mimeType,
          duration: DURATION,
          fileName: "night-signal-loop.webm",
        });
      });
      recorder.addEventListener("error", (event) => {
        mixedStream.getTracks().forEach((track) => track.stop());
        reject(event.error || new Error("录制失败"));
      });
    });

    const tick = () => {
      if (cancelled) return;
      const elapsed = Math.max(0, (performance.now() - startPerfTime) / 1000);
      const time = Math.min(DURATION, elapsed);
      drawPoster(canvas, project, time);
      onFrame(time);
      onProgress(Math.min(1, elapsed / DURATION), time);

      if (elapsed >= DURATION) {
        if (recorder.state !== "inactive") recorder.stop();
        return;
      }
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    timeoutId = window.setTimeout(() => {
      if (recorder?.state === "recording") recorder.stop();
    }, DURATION * 1000 + 900);

    return complete;
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      clearTimeout(timeoutId);
      audio.stopPreview();
      if (recorder && recorder.state !== "inactive") recorder.stop();
    },
  };
}
