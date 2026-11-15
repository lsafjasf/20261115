import { ArrayBufferTarget, Muxer } from "webm-muxer";
import { DURATION, FPS, HEIGHT, LAYER_ORDER, WIDTH } from "./scenes.js";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 15000);
}

export function createProjectData(scenes, activeSceneId) {
  return {
    format: "focal-drift-project",
    version: 1,
    createdAt: new Date().toISOString(),
    duration: DURATION,
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    activeScene: activeSceneId,
    layerOrder: LAYER_ORDER,
    audio: {
      engine: "Web Audio",
      description: "low ambient drone, noise and filtered tonal layers",
    },
    scenes: scenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      subtitle: scene.subtitle,
      accent: scene.accent,
      base: scene.base,
      layers: {
        background: { ...scene.layers.background },
        midground: { ...scene.layers.midground },
        foreground: { ...scene.layers.foreground },
      },
      focus: {
        type: "cubicBezier",
        points: scene.focus.points.map((point) => ({ x: point.x, y: point.y })),
      },
    })),
  };
}

export function exportProject(scenes, activeSceneId) {
  const project = createProjectData(scenes, activeSceneId);
  const blob = new Blob([JSON.stringify(project, null, 2)], {
    type: "application/json",
  });
  downloadBlob(blob, "focal-drift-project.json");
  return project;
}

function supportedMimeType() {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function selectWebCodecsConfig() {
  if (typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined") {
    return null;
  }
  const candidates = [
    {
      codec: "vp09.00.10.08",
      muxerCodec: "V_VP9",
      mimeType: "video/webm;codecs=vp9,opus",
    },
    {
      codec: "vp8",
      muxerCodec: "V_VP8",
      mimeType: "video/webm;codecs=vp8,opus",
    },
  ];
  const videoConfig = {
    width: WIDTH,
    height: HEIGHT,
    bitrate: 7_000_000,
    framerate: FPS,
    latencyMode: "quality",
  };
  const audioConfig = {
    codec: "opus",
    sampleRate: 48000,
    numberOfChannels: 2,
    bitrate: 128_000,
  };
  const audioSupport = await AudioEncoder.isConfigSupported(audioConfig);
  if (!audioSupport.supported) return null;

  for (const candidate of candidates) {
    const config = { ...videoConfig, codec: candidate.codec };
    const support = await VideoEncoder.isConfigSupported(config);
    if (support.supported) {
      return {
        ...candidate,
        videoConfig: config,
        audioConfig,
      };
    }
  }
  return null;
}

function waitForEncoder(encoder) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 40);
    encoder.addEventListener(
      "dequeue",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

async function encodeAudio(muxer, config, audioBuffer) {
  let encoderError = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (error) => {
      encoderError = error;
    },
  });
  encoder.configure(config);

  const chunkFrames = 4096;
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  const sourceChannels = Array.from({ length: channels }, (_, index) =>
    audioBuffer.getChannelData(index),
  );
  for (let offset = 0; offset < audioBuffer.length; offset += chunkFrames) {
    if (encoderError) throw encoderError;
    const frameCount = Math.min(chunkFrames, audioBuffer.length - offset);
    const planar = new Float32Array(frameCount * channels);
    sourceChannels.forEach((source, channel) => {
      planar.set(source.subarray(offset, offset + frameCount), channel * frameCount);
    });
    const audioData = new AudioData({
      format: "f32-planar",
      sampleRate,
      numberOfFrames: frameCount,
      numberOfChannels: channels,
      timestamp: Math.round((offset / sampleRate) * 1_000_000),
      data: planar,
    });
    encoder.encode(audioData);
    audioData.close();
    if (encoder.encodeQueueSize > 10) await waitForEncoder(encoder);
  }
  await encoder.flush();
  encoder.close();
  if (encoderError) throw encoderError;
}

async function encodeVideoFrames({ muxer, config, renderer, scene, onProgress }) {
  let encoderError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      encoderError = error;
    },
  });
  encoder.configure(config);

  const totalFrames = Math.round(DURATION * FPS);
  const frameDuration = Math.round(1_000_000 / FPS);
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
    if (encoderError) throw encoderError;
    const frameTime = frameIndex / FPS;
    renderer.render(scene, frameTime, { editor: false });
    const frame = new VideoFrame(renderer.canvas, {
      timestamp: Math.round(frameTime * 1_000_000),
      duration: frameDuration,
    });
    encoder.encode(frame, { keyFrame: frameIndex % (FPS * 2) === 0 });
    frame.close();
    if (frameIndex % 3 === 0) onProgress?.(frameTime, DURATION);
    if (encoder.encodeQueueSize > 8) await waitForEncoder(encoder);
  }
  await encoder.flush();
  encoder.close();
  if (encoderError) throw encoderError;
}

async function exportWithWebCodecs({ renderer, scene, audio, capability, onProgress }) {
  const audioBuffer = await audio.renderOffline(DURATION);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: capability.muxerCodec,
      width: WIDTH,
      height: HEIGHT,
      frameRate: FPS,
    },
    audio: {
      codec: "A_OPUS",
      numberOfChannels: 2,
      sampleRate: 48000,
    },
    firstTimestampBehavior: "offset",
  });

  await Promise.all([
    encodeAudio(muxer, capability.audioConfig, audioBuffer),
    encodeVideoFrames({
      muxer,
      config: capability.videoConfig,
      renderer,
      scene,
      onProgress,
    }),
  ]);
  muxer.finalize();
  onProgress?.(DURATION, DURATION);
  const blob = new Blob([target.buffer], { type: capability.mimeType });
  if (blob.size < 1000) throw new Error("导出的 WebM 为空，请重试");
  downloadBlob(blob, `focal-${scene.id}-8s.webm`);
  return {
    blob,
    mimeType: capability.mimeType,
    duration: DURATION,
    frames: Math.round(DURATION * FPS),
    filename: `focal-${scene.id}-8s.webm`,
  };
}

async function exportWebMFallback({ renderer, scene, audio, onProgress }) {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("当前浏览器不支持 MediaRecorder");
  }

  renderer.render(scene, 0, { editor: false });
  await audio.prepareExport();
  const stream = renderer.canvas.captureStream(FPS);
  const audioTrack = audio.getAudioTrack();
  if (audioTrack) stream.addTrack(audioTrack);

  const mimeType = supportedMimeType();
  const options = {
    videoBitsPerSecond: 7_500_000,
    audioBitsPerSecond: 128_000,
  };
  if (mimeType) options.mimeType = mimeType;
  const recorder = new MediaRecorder(stream, options);
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });

  const stopped = new Promise((resolve, reject) => {
    recorder.addEventListener("stop", resolve, { once: true });
    recorder.addEventListener(
      "error",
      () => reject(recorder.error || new Error("WebM 编码失败")),
      { once: true },
    );
  });

  recorder.start(250);
  const startedAt = performance.now();
  const totalFrames = Math.round(DURATION * FPS);
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const targetTime = startedAt + (frame * 1000) / FPS;
    const waitTime = targetTime - performance.now();
    if (waitTime > 0) await wait(waitTime);
    const frameTime = frame / FPS;
    renderer.render(scene, frameTime, { editor: false });
    onProgress?.(frameTime, DURATION);
  }
  const remaining = startedAt + DURATION * 1000 - performance.now();
  if (remaining > 0) await wait(remaining);
  onProgress?.(DURATION, DURATION);
  await wait(50);
  recorder.stop();
  stream.getVideoTracks().forEach((track) => track.stop());
  await stopped;
  await audio.finishExport();

  const blob = new Blob(chunks, { type: mimeType || "video/webm" });
  if (blob.size < 1000) throw new Error("导出的 WebM 为空，请重试");
  downloadBlob(blob, `focal-${scene.id}-8s.webm`);
  return {
    blob,
    mimeType: mimeType || "video/webm",
    duration: DURATION,
    filename: `focal-${scene.id}-8s.webm`,
  };
}

export async function exportWebM(options) {
  let capability = null;
  try {
    capability = await selectWebCodecsConfig();
  } catch {
    capability = null;
  }
  if (capability) {
    try {
      return await exportWithWebCodecs({ ...options, capability });
    } catch (error) {
      console.warn("WebCodecs export failed, falling back to MediaRecorder.", error);
    }
  }
  return exportWebMFallback(options);
}
