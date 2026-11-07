import { test, expect } from "bun:test";
import { directNavmeshMask4x } from "./latest-direct-navmesh-mask.mjs";

const fixture = () => ({
  width: 2,
  height: 2,
  rgba: new Uint8Array(16),
  previous: new Uint8Array(64),
});
test("native border order retains previous corners, rather than resetting output", () => {
  const input = fixture();
  input.previous.fill(165);
  const out = directNavmeshMask4x(input);
  expect([out.width, out.height]).toEqual([8, 8]);
  expect(Array.from(out.bytes.subarray(0, 8))).toEqual([
    165, 165, 0, 0, 0, 0, 165, 165,
  ]);
  expect(Array.from(out.bytes.subarray(16, 24))).toEqual(Array(8).fill(0));
  expect(Array.from(out.bytes.subarray(56, 64))).toEqual([
    165, 165, 0, 0, 0, 0, 165, 165,
  ]);
  expect(Array.from(input.previous)).toEqual(Array(64).fill(165));
});
test("blue-byte threshold is strictly above128 and ignores other source channels", () => {
  const low = fixture();
  for (let i = 0; i < 4; i++) low.rgba[i * 4 + 2] = 128;
  const high = structuredClone(low);
  for (let i = 0; i < 4; i++) high.rgba[i * 4 + 2] = 129;
  expect(directNavmeshMask4x(low).bytes[27]).toBe(0);
  expect(directNavmeshMask4x(high).bytes[27]).toBe(255);
  const other = structuredClone(high);
  for (let i = 0; i < other.rgba.length; i++)
    if (i % 4 !== 2) other.rgba[i] = (i * 17) % 256;
  expect(directNavmeshMask4x(other).bytes).toEqual(
    directNavmeshMask4x(high).bytes,
  );
});
test("output and repeated updates retain explicit surface ownership", () => {
  const backing = new Uint8Array(80).fill(165),
    input = {
      ...fixture(),
      rgba: backing.subarray(0, 16),
      previous: backing.subarray(16),
    };
  const before = backing.slice(),
    first = directNavmeshMask4x(input);
  expect(backing).toEqual(before);
  expect(first.bytes.buffer).not.toBe(backing.buffer);
  const retained = first.bytes.slice();
  first.bytes.fill(17);
  expect(directNavmeshMask4x(input).bytes).toEqual(retained);
  // A second update is deliberately NOT idempotent: its border rows now copy
  // the interior side columns fixed at the end of the first update.
  const second = directNavmeshMask4x({ ...input, previous: retained });
  expect(second.bytes).toEqual(new Uint8Array(64).fill(255));
  expect(retained[0]).toBe(165);
});
test("invalid dimensions or ambiguous missing previous surface fail explicitly", () => {
  for (const bad of [
    { width: 1 },
    { height: 1 },
    { width: 1025 },
    { width: 2.5 },
    { previous: null },
    { previous: new Uint8Array(63) },
    { rgba: new Uint8Array(15) },
    { rgba: new Uint8ClampedArray(16) },
  ])
    expect(() => directNavmeshMask4x({ ...fixture(), ...bad })).toThrow(
      /explicit navgrid RGBA/,
    );
});
