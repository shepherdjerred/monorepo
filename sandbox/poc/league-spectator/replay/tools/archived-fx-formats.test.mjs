import { expect, test } from "bun:test";
import { identifyArchivedFxFormat } from "./archived-fx-formats.mjs";

function dds(dx10 = false) {
  const bytes = new Uint8Array(dx10 ? 148 : 128),
    view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("DDS "));
  for (const [offset, value] of [
    [4, 124],
    [76, 32],
    [12, 64],
    [16, 32],
  ])
    view.setUint32(offset, value, true);
  if (dx10) {
    bytes.set(new TextEncoder().encode("DX10"), 84);
    view.setUint32(132, 3, true);
    view.setUint32(140, 1, true);
  }
  return { bytes, view };
}
test("texture routing uses source headers, independent of guessed filenames", () => {
  const bytes = new Uint8Array(12),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00584554, true);
  view.setUint16(4, 32, true);
  view.setUint16(6, 64, true);
  bytes[9] = 10;
  expect(identifyArchivedFxFormat(bytes).translation).toBe(
    "pinned-texture-mip0",
  );
  bytes[10] = 1;
  expect(identifyArchivedFxFormat(bytes).translation).toBe(
    "unsupported-texture-resource-type",
  );
  expect(identifyArchivedFxFormat(new Uint8Array([1, 2])).translation).toBe(
    "unsupported-original-format",
  );
});
test("DDS volume, cube and array sources cannot silently become 2D Mip0 previews", () => {
  expect(identifyArchivedFxFormat(dds().bytes).translation).toBe(
    "pinned-texture-mip0",
  );
  for (const mutate of [
    (value) => value.view.setUint32(112, 0x200, true),
    (value) => value.view.setUint32(24, 4, true),
  ]) {
    const value = dds();
    mutate(value);
    expect(identifyArchivedFxFormat(value.bytes).translation).toBe(
      "unsupported-texture-resource-type",
    );
  }
  for (const mutate of [
    (value) => value.view.setUint32(132, 4, true),
    (value) => value.view.setUint32(136, 4, true),
    (value) => value.view.setUint32(140, 2, true),
  ]) {
    const value = dds(true);
    mutate(value);
    expect(identifyArchivedFxFormat(value.bytes).translation).toBe(
      "unsupported-texture-resource-type",
    );
  }
  expect(() =>
    identifyArchivedFxFormat(dds(true).bytes.subarray(0, 130)),
  ).toThrow("DX10");
});
