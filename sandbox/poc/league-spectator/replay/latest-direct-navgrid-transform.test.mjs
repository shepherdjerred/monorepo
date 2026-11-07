import { test, expect } from "bun:test";
import { directNavgridTransform } from "./latest-direct-navgrid-transform.mjs";
const hex = (value) => new Uint8Array(value.buffer).toHex();
test("native center/extent transform preserves signed zero", () => {
  expect(
    hex(directNavgridTransform({ center: [0, 0, 0], extent: [100, 0, 200] })),
  ).toBe("0ad7233c0ad7a33b0000003f0000003f");
  const atOrigin = directNavgridTransform({
    center: [50, 0, 100],
    extent: [100, 0, 200],
  });
  expect(Object.is(atOrigin[2], -0)).toBe(true);
  expect(Object.is(atOrigin[3], -0)).toBe(true);
});
test("actual loaded getter precision is retained instead of rounded source coordinates", () => {
  const actual = directNavgridTransform({
    center: [6603.41162109375, -189.3690948486328, 6243.9912109375],
    extent: [12400, 0, 11850],
  });
  expect(hex(actual)).toBe("0b20a93890f9b038874105bd6c85dcbc");
  expect(
    hex(
      directNavgridTransform({
        center: [6603.411, 0, 6243.991],
        extent: [12400, 0, 11850],
      }),
    ),
  ).not.toBe(hex(actual));
});
test("only X/Z participate while inputs and independent outputs retain ownership", () => {
  const center = new Float32Array([123.5, -77, -456.25]),
    extent = new Float32Array([37, 0, 109]);
  const before = [center.slice(), extent.slice()],
    a = directNavgridTransform({ center, extent });
  expect(hex(a)).toBe("c967dd3cda4f163c239f35c0e8f19540");
  expect(
    hex(
      directNavgridTransform({
        center: [123.5, 99, -456.25],
        extent: [37, 1234, 109],
      }),
    ),
  ).toBe(hex(a));
  a.fill(17);
  expect(hex(directNavgridTransform({ center, extent }))).toBe(
    "c967dd3cda4f163c239f35c0e8f19540",
  );
  expect(center).toEqual(before[0]);
  expect(extent).toEqual(before[1]);
});
test("incompatible or overflowing vectors fail without guessed extents", () => {
  for (const input of [
    { center: [0, 0, 0], extent: [0, 0, 1] },
    { center: [0, 0, 0], extent: [-1, 0, 1] },
    { center: [0, 0, 0], extent: [1e-50, 0, 1] },
    { center: [0, 0, 0], extent: [1e-45, 0, 1] },
    { center: [Infinity, 0, 0], extent: [1, 0, 1] },
    { center: [0, NaN, 0], extent: [1, 0, 1] },
    { center: ["0", 0, 0], extent: [1, 0, 1] },
    { center: Array(3), extent: [1, 0, 1] },
    { center: new Float64Array(3), extent: [1, 0, 1] },
  ])
    expect(() => directNavgridTransform(input)).toThrow();
});
