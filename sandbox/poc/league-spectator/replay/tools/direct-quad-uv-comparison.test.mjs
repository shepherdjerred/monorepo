import { expect, test } from "bun:test";
import { compareDirectQuadUv } from "./direct-quad-uv-comparison.mjs";

function fixture() {
  const raw = new Uint8Array(4 * 28),
    view = new DataView(raw.buffer),
    attributes = {
      a_TEXCOORD: new Uint16Array(16),
      a_TEXCOORD1: new Uint16Array(8),
    };
  for (let vertex = 0; vertex < 4; vertex++)
    for (let lane = 0; lane < 6; lane++) {
      const half = [
        vertex % 2 ? 0x3c00 : 0,
        vertex > 1 ? 0x3c00 : 0,
        0x4000,
        0,
        0x3800,
        0x3c00,
      ][lane];
      view.setUint16(vertex * 28 + 16 + lane * 2, half, true);
      if (lane < 4) attributes.a_TEXCOORD[vertex * 4 + lane] = half;
      else attributes.a_TEXCOORD1[vertex * 2 + lane - 4] = half;
    }
  return { raw, attributes };
}
test("all six packed native UV lanes are independent numerical gates", () => {
  const { raw, attributes } = fixture(),
    mismatches = [];
  expect(
    compareDirectQuadUv(attributes, raw, { id: "source" }, mismatches),
  ).toBe(24);
  expect(mismatches).toEqual([]);
  for (let lane = 0; lane < 6; lane++) {
    const f = fixture(),
      failures = [];
    if (lane < 4) f.attributes.a_TEXCOORD[lane] ^= 1;
    else f.attributes.a_TEXCOORD1[lane - 4] ^= 1;
    compareDirectQuadUv(f.attributes, f.raw, { id: "source" }, failures);
    expect(failures).toEqual([
      {
        id: "source",
        kind: "packed-quad-uv",
        vertex: 0,
        lane,
        actual:
          lane < 4
            ? f.attributes.a_TEXCOORD[lane]
            : f.attributes.a_TEXCOORD1[lane - 4],
        expected: new DataView(f.raw.buffer).getUint16(16 + lane * 2, true),
      },
    ]);
  }
});
test("partial layouts cannot pass a packed-UV oracle vacuously", () => {
  const { raw, attributes } = fixture();
  for (const [a, r] of [
    [{ ...attributes, a_TEXCOORD: new Uint16Array(15) }, raw],
    [{ ...attributes, a_TEXCOORD1: new Uint16Array(7) }, raw],
    [attributes, raw.subarray(1)],
  ])
    expect(() => compareDirectQuadUv(a, r, {}, [])).toThrow(
      "Exact native quad UV layout required",
    );
});
