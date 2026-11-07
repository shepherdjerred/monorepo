// Exact byte projection for the installed exporter's existing static PNGs.
// No palette/bit-depth/color-space/interlace/animation conversion is inferred.
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
export const SELECTED_RGBA8_PNG_POLICY =
  "strict-static-rgba8-png-channel-bytes-v1";
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
export async function decodeLatestRgba8Png(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length < 45 ||
    bytes.length > 128 * 1024 * 1024 ||
    !signature.every((value, i) => bytes[i] === value)
  )
    throw Error("Bounded static PNG bytes required");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    idat = [];
  let offset = 8,
    width = null,
    height = null,
    ended = false,
    dataEnded = false,
    sawPalette = false,
    compressedLength = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length || ended)
      throw Error("Malformed PNG chunk/trailing data");
    const size = view.getUint32(offset),
      end = offset + 12 + size;
    if (end > bytes.length) throw Error("PNG chunk exceeds source bytes");
    const nameBytes = bytes.subarray(offset + 4, offset + 8),
      name = String.fromCharCode(...nameBytes),
      data = bytes.subarray(offset + 8, offset + 8 + size);
    if (
      !/^[A-Za-z]{4}$/.test(name) ||
      crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)
    )
      throw Error("PNG chunk name/CRC differs");
    if (width === null && name !== "IHDR")
      throw Error("PNG must begin with IHDR");
    if (name === "IHDR") {
      if (offset !== 8 || size !== 13 || width !== null)
        throw Error("One complete PNG IHDR required");
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if (
        width < 1 ||
        width > 16384 ||
        height < 1 ||
        height > 16384 ||
        width * height > 16777216 ||
        data[8] !== 8 ||
        data[9] !== 6 ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      )
        throw Error(
          "Only bounded noninterlaced RGBA8 PNG source format is approved",
        );
    } else if (name === "IDAT") {
      if (dataEnded) throw Error("PNG IDAT chunks must be consecutive");
      idat.push(data);
      compressedLength += size;
    } else {
      if (idat.length) dataEnded = true;
      if (name === "IEND") {
        if (size !== 0 || !idat.length)
          throw Error("PNG IEND requires image data");
        ended = true;
      } else if (name === "PLTE") {
        if (sawPalette || idat.length || size < 3 || size > 768 || size % 3)
          throw Error("Invalid optional PNG palette hint");
        sawPalette = true;
      } else if (
        ["acTL", "fcTL", "fdAT", "tRNS"].includes(name) ||
        name[0] === name[0].toUpperCase()
      )
        throw Error(`Unapproved PNG chunk format: ${name}`);
      // Ancillary color-space metadata is intentionally not applied. The
      // material consumes the stored channel bytes with THREE.NoColorSpace.
    }
    offset = end;
  }
  if (!ended || !compressedLength || typeof DecompressionStream !== "function")
    throw Error("Complete PNG and deflate decompressor required");
  const compressed = new Uint8Array(compressedLength);
  let cursor = 0;
  for (const data of idat) {
    compressed.set(data, cursor);
    cursor += data.length;
  }
  const stride = width * 4,
    expected = (stride + 1) * height,
    inflated = new Uint8Array(expected),
    reader = new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"))
      .getReader();
  let length = 0,
    complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      if (length + value.length > expected)
        throw Error("PNG inflate exceeds exact row inventory");
      inflated.set(value, length);
      length += value.length;
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (length !== expected) throw Error("PNG inflate row inventory differs");
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const input = row * (stride + 1),
      filter = inflated[input],
      output = row * stride;
    if (filter > 4) throw Error("Unapproved PNG row filter");
    for (let column = 0; column < stride; column++) {
      const left = column >= 4 ? rgba[output + column - 4] : 0,
        up = row ? rgba[output + column - stride] : 0,
        upperLeft = row && column >= 4 ? rgba[output + column - stride - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >>> 1;
      else if (filter === 4) {
        const p = left + up - upperLeft,
          a = Math.abs(p - left),
          b = Math.abs(p - up),
          c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      }
      rgba[output + column] = (inflated[input + column + 1] + predictor) & 255;
    }
  }
  return { width, height, data: rgba };
}
