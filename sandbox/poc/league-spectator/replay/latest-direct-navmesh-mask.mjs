// Original 16.21.829.8620 CPU expansion, 0x741055..0x741240.
// This consumes an explicit current navgrid RGBA surface. It does not recover
// that surface from height samples or invent passability from terrain geometry.
export const DIRECT_NAVMESH_MASK_TABLE_SHA =
  "dd7549d63f4dbe9cde8ba813fe2be5e9db334b0e54d65edaa0ad5bc4ca100fd6";
const tiles = Uint8Array.fromHex(
  "00000000000000000000000000000000" +
    "ff7f00007f0000000000000000000000" +
    "00007fff0000007f0000000000000000" +
    "ffffffffffffffff0000000000000000" +
    "00000000000000007f000000ff7f0000" +
    "ffff0000ffff0000ffff0000ffff0000" +
    "00007fff0000007f7f000000ff7f0000" +
    "ffffffffffffffffffffff7fffff7f00" +
    "00000000000000000000007f00007fff" +
    "ff7f00007f0000000000007f00007fff" +
    "0000ffff0000ffff0000ffff0000ffff" +
    "ffffffffffffffff7fffffff007fffff" +
    "0000000000000000ffffffffffffffff" +
    "ffff7f00ffffff7fffffffffffffffff" +
    "007fffff7fffffffffffffffffffffff" +
    "ffffffffffffffffffffffffffffffff",
);

export function directNavmeshMask4x({ width, height, rgba, previous }) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    width > 1024 ||
    height > 1024 ||
    !(rgba instanceof Uint8Array) ||
    rgba.length !== width * height * 4 ||
    !(previous instanceof Uint8Array) ||
    previous.length !== width * height * 16
  )
    throw Error("Bounded explicit navgrid RGBA surface required");
  const outWidth = width * 4,
    outHeight = height * 4,
    bytes = previous.slice();
  for (let y = 0; y < height - 1; y++)
    for (let x = 0; x < width - 1; x++) {
      const at = (y * width + x) * 4 + 2;
      const code =
        (rgba[at] >= 129 ? 1 : 0) |
        (rgba[at + 4] >= 129 ? 2 : 0) |
        (rgba[at + width * 4] >= 129 ? 4 : 0) |
        (rgba[at + width * 4 + 4] >= 129 ? 8 : 0);
      for (let row = 0; row < 4; row++) {
        const target = (y * 4 + row + 2) * outWidth + x * 4 + 2;
        bytes.set(
          tiles.subarray(code * 16 + row * 4, code * 16 + row * 4 + 4),
          target,
        );
      }
    }
  // The producer duplicates the two border rows BEFORE fixing the border
  // columns of interior rows. Corner values therefore depend on the supplied
  // previous surface. Do not silently reset retained output on each update.
  for (const target of [0, 1])
    bytes.copyWithin(target * outWidth, 2 * outWidth, 3 * outWidth);
  for (const target of [outHeight - 2, outHeight - 1])
    bytes.copyWithin(
      target * outWidth,
      (outHeight - 3) * outWidth,
      (outHeight - 2) * outWidth,
    );
  for (let y = 2; y < outHeight - 2; y++) {
    const start = y * outWidth;
    bytes[start] = bytes[start + 1] = bytes[start + 2];
    bytes[start + outWidth - 1] = bytes[start + outWidth - 2] =
      bytes[start + outWidth - 3];
  }
  return { width: outWidth, height: outHeight, bytes };
}
