import { expect, test } from "bun:test";
import { canonicalOriginalDefaultPixel } from "./scene-cold-default-textures.mjs";
const digest = (bytes) =>
  new Bun.CryptoHasher("sha256").update(new Uint8Array(bytes)).digest("hex");
const resource = () => ({
  gpuBytesVerified: true,
  kind: "2d",
  nativeFormat: 2,
  nativeType: 0,
  width: 1,
  height: 1,
  layers: 1,
  mips: 1,
  flags: 0,
  levelsHex: [["01020304"]],
  nativeSourceSha256: digest([1, 2, 3, 4]),
  readbacks: [{ mip: 0, layer: 0, bytes: 4, sha256: digest([3, 2, 1, 4]) }],
});
test("original BGRA bytes project to exactly verified RGBA GPU bytes", async () => {
  const value = await canonicalOriginalDefaultPixel(resource());
  expect(value.rgba).toEqual([3, 2, 1, 4]);
  expect(value.nativeSourceSha256).toBe(digest([1, 2, 3, 4]));
  expect(value.rgbaSha256).toBe(digest([3, 2, 1, 4]));
});
test("unproved dimensions/formats/levels and false GPU dispositions reject", async () => {
  for (const change of [
    { width: 2 },
    { nativeFormat: 24 },
    { nativeType: 3 },
    { mips: 2 },
    { gpuBytesVerified: false },
    { flags: 1 },
    { levelsHex: [["0102030405"]] },
    { layers: 2 },
  ])
    await expect(
      canonicalOriginalDefaultPixel({ ...resource(), ...change }),
    ).rejects.toThrow("Exact original");
});
test("original source hash and complete GPU readback are independently required", async () => {
  const wrongSource = {
    ...resource(),
    nativeSourceSha256: digest([9, 9, 9, 9]),
  };
  await expect(canonicalOriginalDefaultPixel(wrongSource)).rejects.toThrow(
    "GPU byte readback differs",
  );
  for (const change of [
    { sha256: digest([1, 2, 3, 4]) },
    { bytes: 3 },
    { mip: 1 },
    { layer: 1 },
  ]) {
    const value = resource();
    value.readbacks[0] = { ...value.readbacks[0], ...change };
    await expect(canonicalOriginalDefaultPixel(value)).rejects.toThrow(
      "GPU byte readback differs",
    );
  }
});
