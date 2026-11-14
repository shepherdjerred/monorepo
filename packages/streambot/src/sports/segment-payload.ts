import { gunzipSync, inflateSync } from "node:zlib";

const MAX_BYTES = 32 * 1024 * 1024;
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const decoder = new TextDecoder();

function paeth(left: number, above: number, diagonal: number): number {
  const prediction = left + above - diagonal;
  const a = Math.abs(prediction - left);
  const b = Math.abs(prediction - above);
  const c = Math.abs(prediction - diagonal);
  return a <= b && a <= c ? left : b <= c ? above : diagonal;
}

function pngLayout(input: Uint8Array): {
  width: number;
  height: number;
  channels: number;
} {
  if (input.length < 33 || input.length > MAX_BYTES)
    throw new Error("Invalid sports PNG size");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const channels = input[25] === 2 ? 3 : input[25] === 6 ? 4 : 0;
  const stride = width * channels;
  if (
    width === 0 ||
    height === 0 ||
    channels === 0 ||
    input[24] !== 8 ||
    input[28] !== 0 ||
    (stride + 1) * height > MAX_BYTES
  ) {
    throw new Error("Unsupported sports PNG layout");
  }
  return { width, height, channels };
}

function compressedPixels(input: Uint8Array): Buffer {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const chunks: Uint8Array[] = [];
  for (let offset = 8; offset + 12 <= input.length;) {
    const length = view.getUint32(offset);
    if (length > input.length - offset - 12)
      throw new Error("Truncated sports PNG chunk");
    const kind = decoder.decode(input.subarray(offset + 4, offset + 8));
    if (kind === "IDAT")
      chunks.push(input.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (kind === "IEND") break;
  }
  if (chunks.length === 0) throw new Error("Missing sports PNG pixels");
  return inflateSync(Buffer.concat(chunks), { maxOutputLength: MAX_BYTES });
}

function predictor(
  filter: number,
  left: number,
  above: number,
  diagonal: number,
): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return above;
    case 3:
      return Math.floor((left + above) / 2);
    case 4:
      return paeth(left, above, diagonal);
    default:
      throw new Error("Unknown sports PNG filter");
  }
}

function reconstructPixels(
  raw: Uint8Array,
  stride: number,
  height: number,
  channels: number,
): Uint8Array {
  if (raw.length !== (stride + 1) * height)
    throw new Error("Invalid sports PNG pixel count");
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    reconstructRow({ raw, pixels, stride, channels, y });
  }
  return pixels;
}

function reconstructRow(input: {
  raw: Uint8Array;
  pixels: Uint8Array;
  stride: number;
  channels: number;
  y: number;
}): void {
  const { raw, pixels, stride, channels, y } = input;
  const filter = raw[y * (stride + 1)];
  if (filter === undefined || filter > 4)
    throw new Error("Unknown sports PNG filter");
  for (let x = 0; x < stride; x++) {
    const offset = y * stride + x;
    const left = x >= channels ? (pixels[offset - channels] ?? 0) : 0;
    const above = y > 0 ? (pixels[offset - stride] ?? 0) : 0;
    const diagonal =
      x >= channels && y > 0 ? (pixels[offset - stride - channels] ?? 0) : 0;
    const prediction = predictor(filter, left, above, diagonal);
    pixels[offset] = ((raw[y * (stride + 1) + x + 1] ?? 0) + prediction) & 255;
  }
}

function unpackEnvelope(pixels: Uint8Array): Uint8Array {
  const marker = decoder.decode(pixels.subarray(0, 8));
  const prefix = marker === "TIKTIKPX" ? 8 : marker.startsWith("KWP1") ? 4 : 0;
  if (prefix === 0 || pixels.length < prefix + 4)
    throw new Error("Unknown sports segment envelope");
  const length = new DataView(pixels.buffer).getUint32(prefix);
  if (length === 0 || length > pixels.length - prefix - 4)
    throw new Error("Truncated sports segment envelope");
  const payload = pixels.slice(prefix + 4, prefix + 4 + length);
  return payload[0] === 31 && payload[1] === 139
    ? gunzipSync(payload, { maxOutputLength: MAX_BYTES })
    : payload;
}

/** Unpack the provider's PNG-carried transport stream; ordinary media passes through. */
export function unwrapSportsSegment(input: Uint8Array): Uint8Array {
  if (!PNG.every((value, index) => input[index] === value)) return input;
  const { width, height, channels } = pngLayout(input);
  return unpackEnvelope(
    reconstructPixels(
      compressedPixels(input),
      width * channels,
      height,
      channels,
    ),
  );
}
