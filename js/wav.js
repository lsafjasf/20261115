export class ClippingError extends Error {
  constructor(info) {
    super(`Export blocked: ${info.clippedSamples} sample(s) reach 0 dBFS`);
    this.name = "ClippingError";
    this.info = info;
  }
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function writePcm24(view, offset, sample) {
  let value = Math.round(Math.max(-1, Math.min(1, sample)) * 8388607);
  if (value < 0) value += 0x1000000;
  view.setUint8(offset, value & 0xff);
  view.setUint8(offset + 1, (value >> 8) & 0xff);
  view.setUint8(offset + 2, (value >> 16) & 0xff);
}

export function encodeWav(channels, sampleRate = 48000, options = {}) {
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new TypeError("At least one channel is required");
  }

  const bitDepth = options.bitDepth ?? 24;
  if (bitDepth !== 24) {
    throw new RangeError("Only 24-bit PCM export is supported");
  }

  const channelCount = channels.length;
  const frameCount = channels[0].length;
  channels.forEach((channel) => {
    if (channel.length !== frameCount) {
      throw new RangeError("All channels must have the same frame count");
    }
  });

  const bytesPerSample = 3;
  const dataSize = frameCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, bitDepth, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      writePcm24(view, offset, channels[channel][frame]);
      offset += bytesPerSample;
    }
  }

  return new Uint8Array(buffer);
}

export function inspectWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset, length) => {
    let result = "";
    for (let index = 0; index < length; index += 1) {
      result += String.fromCharCode(view.getUint8(offset + index));
    }
    return result;
  };

  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file");
  }

  let offset = 12;
  let fmt = null;
  let dataSize = null;
  while (offset + 8 <= view.byteLength) {
    const id = text(offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      fmt = {
        audioFormat: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        byteRate: view.getUint32(offset + 16, true),
        blockAlign: view.getUint16(offset + 20, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    }
    if (id === "data") {
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }

  if (!fmt || dataSize === null) throw new Error("Missing WAV fmt or data chunk");
  const bytesPerFrame = fmt.blockAlign;
  const frames = dataSize / bytesPerFrame;
  return {
    ...fmt,
    dataSize,
    frames,
    duration: frames / fmt.sampleRate,
    valid: Number.isInteger(frames) && bytesPerFrame === fmt.channels * (fmt.bitsPerSample / 8),
  };
}
