export async function decodePngBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  bitmap.close();
  return {
    width: image.width,
    height: image.height,
    pixels: new Uint8ClampedArray(image.data),
  };
}

export async function hashPixels(pixels) {
  const digest = await crypto.subtle.digest("SHA-256", pixels);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function pixelsToCanvas(pixels, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const image = context.createImageData(width, height);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
  return canvas;
}

export function canvasToPixels(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return new Uint8ClampedArray(
    context.getImageData(0, 0, canvas.width, canvas.height).data,
  );
}

export function canvasPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed."))),
      "image/png",
    );
  });
}

export async function canvasPngRoundTrip(pixels, width, height) {
  const source = pixelsToCanvas(pixels, width, height);
  const blob = await canvasPngBlob(source);
  return decodePngBlob(blob);
}

export function drawThumbnail(canvas, frame, size = 64) {
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, size, size);
  const scale = Math.min(size / frame.width, size / frame.height);
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));
  const source = pixelsToCanvas(frame.pixels, frame.width, frame.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(
    source,
    Math.floor((size - width) / 2),
    Math.floor((size - height) / 2),
    width,
    height,
  );
}

export function drawPixelFrame(canvas, frame) {
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  const image = context.createImageData(frame.width, frame.height);
  image.data.set(frame.pixels);
  context.putImageData(image, 0, 0);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
