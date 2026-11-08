import { expect, test } from "bun:test";
import {
  compileDirectQuadSprite,
  validateDirectQuadSpriteProgram,
  directQuadSpriteFrame,
  directQuadSpriteFrameHalf,
} from "./latest-direct-effect-sprite.mjs";

const source = () => ({ isRandomStartFrame: 1, numFrames: 4 });
test("four-frame controller retains typed flags and constructor-default clocks", () => {
  for (const flag of [0, 1, false, true]) {
    const s = { ...source(), isRandomStartFrame: flag };
    const p = compileDirectQuadSprite(s, "arbitrary-quad");
    expect(p).toEqual({
      numFrames: 4,
      randomStartFrame: !!flag,
      startFrame: 0,
      frameRate: 0,
    });
    expect(Object.isFrozen(p)).toBe(true);
    expect(
      validateDirectQuadSpriteProgram({
        source: s,
        primitive: "arbitrary-quad",
        spriteProgram: p,
      }),
    ).toEqual(p);
  }
});
test("other frame counts, clocks, UV transforms, primitives and corrupt metadata reject", () => {
  for (const s of [
    {},
    { isRandomStartFrame: 1 },
    { numFrames: 4 },
    ...[undefined, null, 2, "1", [], {}].map((isRandomStartFrame) => ({
      ...source(),
      isRandomStartFrame,
    })),
    ...[0, 1, 3, 5, 65535, 4.5, "4", true, null].map((numFrames) => ({
      ...source(),
      numFrames,
    })),
    ...["startFrame", "frameRate", "birthFrameRate", "texDiv", "uvMode"].map(
      (key) => ({ ...source(), [key]: undefined }),
    ),
  ])
    expect(compileDirectQuadSprite(s, "arbitrary-quad")).toBeNull();
  for (const primitive of ["camera-quad", "camera-trail", "mesh", null])
    expect(compileDirectQuadSprite(source(), primitive)).toBeNull();
  const p = compileDirectQuadSprite(source(), "arbitrary-quad");
  for (const spriteProgram of [
    null,
    undefined,
    {},
    { ...p, numFrames: 5 },
    { ...p, randomStartFrame: 1 },
    { ...p, frameRate: 1 },
    { ...p, extra: 0 },
    Object.create(p),
  ])
    expect(() =>
      validateDirectQuadSpriteProgram({
        source: source(),
        primitive: "arbitrary-quad",
        spriteProgram,
      }),
    ).toThrow("Malformed compiled");
});
test("frame calculation reuses float32 chance, wraps one, and emits original half lanes", () => {
  const p = compileDirectQuadSprite(source(), "arbitrary-quad");
  const off = compileDirectQuadSprite(
    { ...source(), isRandomStartFrame: false },
    "arbitrary-quad",
  );
  for (const [chance, expected, half] of [
    [0, 0, 0],
    [0.25, 1, 0x3c00],
    [0.5, 2, 0x4000],
    [0.75, 3, 0x4200],
    [1, 0, 0],
  ]) {
    expect(directQuadSpriteFrame(p, chance)).toBe(expected);
    expect(directQuadSpriteFrameHalf(p, chance)).toBe(half);
    expect(directQuadSpriteFrame(off, chance)).toBe(0);
  }
  for (const chance of [null, false, "0.5", -1, 1.01, Infinity, NaN])
    expect(() => directQuadSpriteFrame(p, chance)).toThrow();
  // Original half rounding can encode four before the shader floors its frame.
  // It must not be clamped to three or wrapped a second time after packing.
  expect(directQuadSpriteFrameHalf(p, 1 - 2 ** -24)).toBe(0x4400);
  for (const program of [
    null,
    {},
    { ...p, startFrame: 1 },
    { ...p, frameRate: 1 },
  ])
    expect(() => directQuadSpriteFrame(program, 0.5)).toThrow();
});
