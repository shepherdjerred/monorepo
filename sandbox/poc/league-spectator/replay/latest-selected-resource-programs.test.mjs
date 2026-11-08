import { test, expect } from "bun:test";
import {
  projectApprovedNegativeCapabilities,
  assertSelectedResourceRoot,
} from "./latest-selected-resource-programs.mjs";
const capability = {
  actorKey: "champions/example/2",
  character: "Example",
  skinId: 2,
  skinPath: "data/example.bin",
  skinSourceSha256: "a".repeat(64),
  gears: [],
};
const metadata = { capabilities: [capability] },
  manifest = {
    actors: {
      [capability.actorKey]: {
        character: "Example",
        skinId: 2,
        skinPath: capability.skinPath,
      },
    },
  },
  sources = {
    actors: {
      [capability.actorKey]: {
        sourceBins: [
          {
            path: capability.skinPath,
            sourceSha256: capability.skinSourceSha256,
          },
        ],
      },
    },
  };
test("selected negative capabilities are exact original actor/source intersections with explicit missing actors", () => {
  const result = projectApprovedNegativeCapabilities(
    metadata,
    manifest,
    sources,
  );
  expect(result.accepted).toEqual([capability]);
  expect(result.omitted).toEqual([]);
  result.accepted[0].gears.push("changed");
  expect(capability.gears).toEqual([]);
  const absent = projectApprovedNegativeCapabilities(
    metadata,
    { actors: {} },
    { actors: {} },
  );
  expect(absent.accepted).toEqual([]);
  expect(absent.omitted).toEqual([
    {
      actorKey: capability.actorKey,
      reason:
        "resource:approved-negative-form-actor-absent-from-selected-content",
    },
  ]);
});
test("a present actor cannot reuse negative capability proof after changing identity or source", () => {
  for (const field of ["character", "skinId", "skinPath"]) {
    const changed = structuredClone(manifest);
    changed.actors[capability.actorKey][field] = "foreign";
    expect(() =>
      projectApprovedNegativeCapabilities(metadata, changed, sources),
    ).toThrow("source differs");
  }
  const changed = structuredClone(sources);
  changed.actors[capability.actorKey].sourceBins[0].sourceSha256 = "b".repeat(
    64,
  );
  expect(() =>
    projectApprovedNegativeCapabilities(metadata, manifest, changed),
  ).toThrow("source differs");
});
test("negative projection rejects accessors before execution and a lookalike catalog cannot approve resource inputs", async () => {
  let called = 0;
  const forged = {
    get actors() {
      called++;
      return {};
    },
  };
  expect(() =>
    projectApprovedNegativeCapabilities(metadata, forged, sources),
  ).toThrow();
  expect(called).toBe(0);
  await expect(
    assertSelectedResourceRoot({
      selection: { profile: () => ({}) },
      profile: {},
    }),
  ).rejects.toThrow("Owned selected static catalog");
});
