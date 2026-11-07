import { expect, test } from "bun:test";
import { createLatestPacketDirectionBasis } from "./latest-packet-direction-basis.mjs";
const profile = {
  clientVersion: "16.21.829.8620",
  protocolDigest: "20e09df23c66b85e",
  decoderImageSha256:
    "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7",
};
test("packet direction produces a supplied horizontal basis with float32 normalization", () => {
  const kernel = createLatestPacketDirectionBasis(profile);
  expect(kernel.horizontal([1, 0, 0])).toEqual([0, 0, -1, 0, 1, 0, 1, 0, 0]);
  expect(kernel.horizontal([3, 0, -4])).toEqual([
    Math.fround(-0.8),
    0,
    Math.fround(-0.6),
    0,
    1,
    0,
    Math.fround(0.6),
    0,
    Math.fround(-0.8),
  ]);
  const negative = kernel.horizontal([-1, 0, 0]);
  expect(Object.is(negative[1], -0)).toBe(true);
  expect(kernel.horizontal([1e-5, 0, 1e-5])).toEqual([
    1, 0, 0, 0, 1, 0, 0, 0, 1,
  ]);
  const result = kernel.horizontal([0, 0, 0]);
  result[0] = 9;
  expect(kernel.horizontal([0, 0, 0])[0]).toBe(1);
});
test("packet direction rejects incompatible build, unknown tilt and malformed vectors", () => {
  expect(() =>
    createLatestPacketDirectionBasis({ ...profile, clientVersion: "new" }),
  ).toThrow();
  const kernel = createLatestPacketDirectionBasis(profile);
  for (const v of [[1, 0.1, 0], [Infinity, 0, 0], [1e100, 0, 0], [1, 0], null])
    expect(() => kernel.horizontal(v)).toThrow();
});
