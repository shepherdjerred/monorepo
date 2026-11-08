import { expect, test } from "bun:test";
import { DirectNavmeshProducer } from "./latest-direct-navmesh-producer.mjs";

const input = (extra = {}) => ({
  now: 1,
  rgba: Uint8Array.from([
    0, 0, 20, 255, 0, 0, 40, 255, 0, 0, 80, 255, 0, 0, 160, 255,
  ]),
  dirty: true,
  force: false,
  modeUpdatesEnabled: true,
  ...extra,
});
test("binary-history masks swap only on source updates; fade never feeds back rendered color", () => {
  const p = new DirectNavmeshProducer({
    width: 2,
    height: 2,
    highResolution: false,
  });
  const first = p.update(input());
  expect(first.upload.bytes).toEqual(Uint8Array.of(20, 40, 80, 160));
  expect(first.upload.target).toBe("mask-a");
  expect(first.passes[0].textures).toEqual({
    current: "mask-b",
    target: "mask-a",
  });
  expect(first.passes[0].parameters).toEqual([0, 0, 0, Math.fround(1.1)]);
  const next = p.update(input({ now: 1.25, dirty: false }));
  expect(next.upload).toBeNull();
  expect(next.passes[0].textures).toEqual(first.passes[0].textures);
  expect(next.passes[0].parameters).toEqual([
    Math.fround(Math.fround(1.2) * 0.25),
    0.125,
    0,
    Math.fround(1.1),
  ]);
  expect(next.passes.map((x) => x.target)).toEqual([
    "output",
    "scratch",
    "output",
    "scratch",
    "output",
  ]);
  expect(next.passes.slice(1).map((x) => x.textures.source)).toEqual([
    "output",
    "scratch",
    "output",
    "scratch",
  ]);
  const changed = p.update(input({ now: 2 }));
  expect(changed.upload.target).toBe("mask-b");
  expect(changed.lastUpdate).toBe(2);
});
test("mode gates dirty upload while explicit force remains independent; results own their bytes", () => {
  const p = new DirectNavmeshProducer({
    width: 2,
    height: 2,
    highResolution: false,
  });
  const gated = p.update(input({ modeUpdatesEnabled: false }));
  expect(gated.upload).toBeNull();
  expect(gated.sourceDirtyCleared).toBe(false);
  const forced = p.update(input({ modeUpdatesEnabled: false, force: true }));
  expect(forced.upload.target).toBe("mask-a");
  forced.upload.bytes.fill(255);
  forced.passes[0].textures.current = "output";
  const next = p.update(input({ now: 2, dirty: false }));
  expect(next.passes[0].textures.current).toBe("mask-b");
  expect(next.scenePublicationEstablished).toBe(false);
  const resources = p.resources();
  expect(resources.targets.every((x) => x.initialBytes === null)).toBe(true);
  resources.masks[0].initialBytes.fill(255);
  expect(p.resources().masks[0].initialBytes.every((v) => v === 0)).toBe(true);
});
test("high-resolution output uses the original retained-border expansion and strict inputs", () => {
  const p = new DirectNavmeshProducer({
    width: 2,
    height: 2,
    highResolution: true,
  });
  const r = p.update(input());
  expect([r.width, r.height, r.upload.bytes.length]).toEqual([8, 8, 64]);
  // Original row-copy-before-column-fix leaves retained zero corners.
  expect([
    r.upload.bytes[0],
    r.upload.bytes[1],
    r.upload.bytes[6],
    r.upload.bytes[7],
  ]).toEqual([0, 0, 0, 0]);
  for (const extra of [
    { now: NaN },
    { now: "1" },
    { dirty: 1 },
    { force: undefined },
    { modeUpdatesEnabled: null },
    { rgba: new Uint8Array(3) },
  ])
    expect(() => p.update(input(extra))).toThrow();
  expect(
    () =>
      new DirectNavmeshProducer({ width: 1, height: 2, highResolution: true }),
  ).toThrow();
});
