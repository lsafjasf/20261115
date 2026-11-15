import {
  FPS, TOTAL_FRAMES, frameToTime, shotWeights,
} from './editor-core.mjs';
import { renderComposite, makeOffscreenCanvases, VIEW_W, VIEW_H } from
  './render.mjs';
import { buildAudioGraph, scheduleEditGains } from './audio-engine.mjs';

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

// Render the 12s cut in real time while MediaRecorder captures a single
// canvas stream + Web Audio destination stream into one WebM container.
export async function exportWebM(cuts, { onProgress, onFrameSample } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  const offscreen = makeOffscreenCanvases();

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: 48000 });
  const destination = ctx.createMediaStreamDestination();
  await ctx.resume();
  const origin = ctx.currentTime + 0.15;
  const graph = buildAudioGraph(ctx, 12, origin);
  graph.master.connect(destination);
  scheduleEditGains(ctx, graph.ambientGains, cuts, origin);

  const videoStream = canvas.captureStream(0); // manual frame pushes
  const videoTrack = videoStream.getVideoTracks()[0];
  const combined = new MediaStream([
    videoTrack,
    ...destination.stream.getAudioTracks(),
  ]);

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(combined, {
    mimeType,
    videoBitsPerSecond: 6_000_000,
    audioBitsPerSecond: 192_000,
  });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });

  const waitFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  recorder.start(250);
  await waitFrame();
  const startedAt = performance.now();

  const sampledShots = [];
  try {
    for (let frame = 0; frame < TOTAL_FRAMES; frame += 1) {
      const t = frameToTime(frame);
      const weights = shotWeights(t, cuts);
      renderComposite(offscreen, canvas, t, weights);
      if (videoTrack.requestFrame) videoTrack.requestFrame();
      if (frame % 15 === 0 || frame === TOTAL_FRAMES - 1) {
        const sample = { frame, weights: weights.map((w) => +w.toFixed(3)) };
        sampledShots.push(sample);
        if (onFrameSample) onFrameSample({ frame, canvas, weights });
      }
      onProgress?.((frame + 1) / TOTAL_FRAMES);
      // Pace to wall clock so the recorder timestamps 30 fps correctly.
      const target = startedAt + frame * (1000 / FPS);
      const delay = target - performance.now();
      if (delay > 0) await sleep(delay);
    }

    // Flush the final frame and let the audio tail land before stopping.
    await sleep(260);
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
    return { blob, mimeType: blob.type, sampledShots };
  } finally {
    videoTrack.stop();
    destination.stream.getTracks().forEach((track) => track.stop());
    if (ctx.state !== 'closed') await ctx.close();
  }
}
