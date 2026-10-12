import sharp from "sharp";

/** Preserve pixels and metadata while keeping the generated asset budget. */
export async function backgroundPngWithinBudget(
  input: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array> {
  if (input.byteLength <= maxBytes) return input;
  const compressed = await sharp(input)
    .keepMetadata()
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
  if (compressed.byteLength > maxBytes) {
    throw new Error(
      `Losslessly compressed background exceeds its ${String(maxBytes)} byte budget: ${String(compressed.byteLength)} bytes`,
    );
  }
  const [before, after] = await Promise.all([
    sharp(input).raw({ depth: "ushort" }).toBuffer({ resolveWithObject: true }),
    sharp(compressed)
      .raw({ depth: "ushort" })
      .toBuffer({ resolveWithObject: true }),
  ]);
  if (
    before.info.width !== after.info.width ||
    before.info.height !== after.info.height ||
    before.info.channels !== after.info.channels ||
    !before.data.equals(after.data)
  ) {
    throw new Error("Background PNG compression changed its decoded pixels");
  }
  return compressed;
}
