import { it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cropRegion } from "#src/capture/suite/region.ts";
import { validateNbt } from "#src/capture/suite/nbt.ts";
import {
  cachedBlob,
  retainBlob,
  type BlobStore,
} from "#src/capture/suite/store.ts";
import {
  defineCaptureSuite,
  presentScene,
  selectScenarios,
  type SuiteScenario,
  type TerrainPatch,
} from "#src/capture/suite/define.ts";
import type { CaptureContext } from "#src/capture/define.ts";
import { integer, memoryStore } from "./suite-fixtures.ts";
import { verifyFixturePatches } from "#src/capture/suite/fixture.ts";

const compound = Buffer.from([10, 0, 0, 0]);

it("reuses a verified terrain fixture only when every requested padded patch matches", async () => {
  const cache = await mkdtemp(path.join(os.tmpdir(), "pinned-fixture-test-"));
  const store = memoryStore();
  const patches: TerrainPatch[] = [
    { world: "world", min: [-16, -16], max: [16, 16], paddingChunks: 2 },
    { world: "creative", min: [0, 0], max: [32, 32], paddingChunks: 2 },
  ];
  try {
    const fixture = await retainBlob(
      store,
      new TextEncoder().encode(
        JSON.stringify({
          schema: 1,
          source: "accepted-csi-export",
          capturedAt: "2026-11-01T00:00:00.000Z",
          patches,
          files: [{ path: "level.dat", sha256: "a".repeat(64) }],
        }),
      ),
    );
    await expect(
      verifyFixturePatches(store, cache, fixture, patches.toReversed()),
    ).resolves.toBeUndefined();
    await expect(
      verifyFixturePatches(store, cache, fixture, patches.slice(1)),
    ).rejects.toThrow("Pinned terrain patches differ");
    await expect(
      verifyFixturePatches(
        store,
        cache,
        fixture,
        patches.map((p) => ({ ...p, paddingChunks: 3 })),
      ),
    ).rejects.toThrow("Pinned terrain patches differ");
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});
const unexpected = (): never => {
  throw new Error("Unexpected scene operation");
};
function chunkNbt(x: number, z: number) {
  return Buffer.concat([
    compound.subarray(0, 3),
    integer("DataVersion", 5000),
    integer("xPos", x),
    integer("zPos", z),
    Buffer.from([0]),
  ]);
}
function region(rx = 0, rz = 0) {
  const bytes = Buffer.alloc(16_384);
  bytes.writeUInt32BE(2 * 256 + 1, 0);
  bytes.writeUInt32BE(3 * 256 + 1, 4);
  for (const sector of [2, 3]) {
    const payload = deflateSync(chunkNbt(rx * 32 + sector - 2, rz * 32));
    bytes.writeUInt32BE(payload.length + 1, sector * 4096);
    bytes[sector * 4096 + 4] = 2;
    payload.copy(bytes, sector * 4096 + 5);
  }
  return bytes;
}
it("crops native chunks across negative region coordinates without changing the source", () => {
  const source = region(-1, -1),
    before = Buffer.from(source);
  const output = cropRegion(
    source,
    { x: -1, z: -1, layer: "region" },
    (x, z) => x === -31 && z === -32,
  );
  expect(output.length).toBe(12_288);
  expect(output.readUInt32BE(0)).toBe(0);
  expect(output.readUInt32BE(4)).toBe(513);
  expect(source).toEqual(before);
});
it("refuses truncated compressed chunk data", () => {
  const source = region();
  source.writeUInt32BE(4094, 8192);
  expect(() =>
    cropRegion(source, { x: 0, z: 0, layer: "region" }, () => true),
  ).toThrow("length");
});
it("refuses overlapping allocations even outside the requested crop", () => {
  const source = region();
  source.writeUInt32BE(513, 4);
  expect(() =>
    cropRegion(source, { x: 0, z: 0, layer: "region" }, () => false),
  ).toThrow("Overlapping");
});
it("validates complete NBT rather than accepting a plausible first byte", () => {
  validateNbt(compound);
  for (const bytes of [
    [10, 0, 0],
    [10, 0, 0, 0, 1],
    [10, 0, 0, 3, 0, 0],
  ])
    expect(() => validateNbt(new Uint8Array(bytes))).toThrow();
});
it("rejects valid NBT chunks stored at the wrong coordinates", () => {
  expect(() =>
    cropRegion(region(), { x: 1, z: 0, layer: "region" }, () => true),
  ).toThrow("coordinates");
  expect(() => validateNbt(compound, { x: 0, z: 0, layer: "region" })).toThrow(
    "DataVersion",
  );
});
it("rejects array-typed version fields even when the NBT stream is well formed", () => {
  const version = integer("DataVersion", 1);
  version[0] = 11;
  const data = Buffer.concat([
    compound.subarray(0, 3),
    version,
    Buffer.from([0, 0, 0, 5]),
    integer("xPos", 0),
    integer("zPos", 0),
    Buffer.from([0]),
  ]);
  validateNbt(data);
  expect(() => validateNbt(data, { x: 0, z: 0, layer: "region" })).toThrow(
    "Invalid chunk field DataVersion",
  );
});
it("checks uploaded bytes and checks cache integrity on every restore", async () => {
  const data = new Map<string, Uint8Array>();
  const store: BlobStore = {
    write: (key, bytes) => {
      data.set(key, bytes);
      return Promise.resolve();
    },
    read: (key) => {
      const bytes = data.get(key);
      if (!bytes) throw new Error("Missing");
      return Promise.resolve(bytes);
    },
  };
  const hash = await retainBlob(store, compound);
  const dir = await mkdtemp(path.join(os.tmpdir(), "suite-test-"));
  try {
    const file = await cachedBlob(store, dir, hash);
    expect(new Uint8Array(await Bun.file(file).arrayBuffer())).toEqual(
      new Uint8Array(compound),
    );
    await Bun.write(file, "corrupt");
    await expect(cachedBlob(store, dir, hash)).rejects.toThrow("corrupt");
  } finally {
    await rm(dir, { recursive: true });
  }
});
it("refuses a successful upload whose readback differs", async () => {
  await expect(
    retainBlob(
      {
        write: () => Promise.resolve(),
        read: () => Promise.resolve(new Uint8Array()),
      },
      compound,
    ),
  ).rejects.toThrow("readback");
});
const scenario: SuiteScenario = {
  id: "cook",
  world: "world",
  anchor: [0, 64, 0],
  helpers: [],
  shots: [
    { schema: 1, name: "pot", caption: "A pot", alt: "Pot", annotations: [] },
  ],
  scene: {
    name: "cook",
    description: "Cook",
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    inspectors: [],
    staging: [0, 0, 0],
    setup: () => Promise.resolve(),
    run: (c) =>
      c.capture({
        schema: 1,
        name: "pot",
        caption: "Old",
        alt: "Old",
        annotations: [],
      }),
  },
};
it("selects a named batch in authored order and refuses partial, duplicate, or empty IDs", () => {
  const other = {
    ...scenario,
    id: "other",
    shots: scenario.shots.map((p) => ({ ...p, name: "other-shot" })),
  };
  const suite = defineCaptureSuite({
    id: "batch",
    bootstrap: [0, 64, 0],
    patches: [
      { world: "world", min: [-16, -16], max: [16, 16], paddingChunks: 2 },
    ],
    scenarios: [scenario, other],
  });
  expect(selectScenarios(suite, { scenario: "other,cook" })).toEqual([
    scenario,
    other,
  ]);
  for (const value of ["cook,missing", "cook,cook", "cook,", ""])
    expect(() => selectScenarios(suite, { scenario: value })).toThrow();
});
it("validates output identity and rejects empty selections", () => {
  const suite = defineCaptureSuite({
    id: "example",
    bootstrap: [0.5, 64, 0.5],
    patches: [
      { world: "world", min: [-16, -16], max: [16, 16], paddingChunks: 2 },
    ],
    scenarios: [scenario],
  });
  expect(selectScenarios(suite, { shot: "pot" })).toEqual([scenario]);
  expect(() =>
    defineCaptureSuite({ ...suite, bootstrap: [1000, 64, 1000] }),
  ).toThrow("bootstrap");
  expect(() =>
    defineCaptureSuite({ ...suite, bootstrap: [-16 * 3 - 0.5, 64, 0] }),
  ).toThrow("bootstrap");
  defineCaptureSuite({ ...suite, bootstrap: [16 * 3 + 0.5, 64, 0] });
  expect(() => selectScenarios(suite, { shot: "missing" })).toThrow();
  expect(() =>
    defineCaptureSuite({
      ...suite,
      scenarios: [{ ...scenario, arrivalCommand: "creative" }],
    }),
  ).toThrow("requires fresh isolation");
  expect(() =>
    defineCaptureSuite({
      ...suite,
      scenarios: [{ ...scenario, clientUi: "server-list" }],
    }),
  ).toThrow("requires fresh isolation");
  const venue: SuiteScenario = {
    ...scenario,
    isolation: "fresh",
    siteMode: "preserve",
    interactionSites: [
      {
        world: "creative",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 8, y: 72, z: 8 },
      },
    ],
  };
  expect(() => defineCaptureSuite({ ...suite, scenarios: [venue] })).toThrow(
    "lacks covering real terrain",
  );
  const patches = [
    ...suite.patches,
    {
      world: "creative",
      min: [-16, -16],
      max: [16, 16],
      paddingChunks: 2,
    } satisfies (typeof suite.patches)[number],
  ];
  defineCaptureSuite({ ...suite, patches, scenarios: [venue] });
  expect(() =>
    defineCaptureSuite({
      ...suite,
      patches,
      scenarios: [{ ...venue, isolation: undefined }],
    }),
  ).toThrow("requires fresh isolation");
  expect(() =>
    defineCaptureSuite({
      ...suite,
      patches,
      scenarios: [
        {
          ...venue,
          interactionSites: [
            {
              world: "world",
              min: { x: 0, y: 64, z: 0 },
              max: { x: 8, y: 72, z: 8 },
            },
          ],
        },
      ],
    }),
  ).toThrow("Duplicate interaction world");
  expect(() =>
    defineCaptureSuite({
      ...suite,
      scenarios: [{ ...scenario, siteMode: "preserve" }],
    }),
  ).toThrow("requires fresh isolation");
  expect(() =>
    defineCaptureSuite({
      ...suite,
      scenarios: [{ ...scenario, features: ["quests"] }],
    }),
  ).toThrow("require fresh isolation");
  defineCaptureSuite({
    ...suite,
    scenarios: [
      {
        ...scenario,
        isolation: "fresh",
        siteMode: "preserve",
        features: ["quests"],
      },
    ],
  });
  expect(() =>
    defineCaptureSuite({
      ...suite,
      legacyOutputs: [{ shot: "missing", path: "/screenshots/old.webp" }],
    }),
  ).toThrow("Unknown legacy shot");
  expect(() =>
    defineCaptureSuite({
      ...suite,
      legacyOutputs: [
        { shot: "pot", path: "/screenshots/old.webp" },
        { shot: "pot", path: "/screenshots/old.webp" },
      ],
    }),
  ).toThrow("Duplicate legacy destination");
  expect(() =>
    defineCaptureSuite({
      ...suite,
      scenarios: [scenario, { ...scenario, id: "another" }],
    }),
  ).toThrow("Duplicate shot");
});
it("uses authored presentation metadata without changing scenario actions", async () => {
  const captures: string[] = [];
  const context: CaptureContext = {
    id: "test",
    target: "sbx-test",
    name: "Camera",
    box: {
      world: "world",
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
    },
    at: unexpected,
    status: unexpected,
    waitFor: unexpected,
    step: unexpected,
    command: unexpected,
    shopAccess: unexpected,
    playerCommand: unexpected,
    feedback: unexpected,
    block: unexpected,
    inspect: unexpected,
    track: unexpected,
    action: unexpected,
    prepare: unexpected,
    defer: unexpected,
    set: unexpected,
    teleport: unexpected,
    lookAt: unexpected,
    use: unexpected,
    attack: unexpected,
    sign: unexpected,
    transfer: unexpected,
    record: unexpected,
    capture: (p) => {
      captures.push(p.caption);
      return Promise.resolve();
    },
  };
  await presentScene(scenario).run(context);
  expect(captures).toEqual(["A pot"]);
});
