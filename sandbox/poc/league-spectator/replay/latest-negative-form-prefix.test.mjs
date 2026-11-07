import { expect, test } from "bun:test";
import {
  createLatestNegativeFormPrefix,
  isLatestNegativeFormPrefix,
} from "./latest-negative-form-prefix.mjs";
import { loadLatestInitialResourcePrefix } from "./latest-initial-resource-prefix.mjs";
const base = ".cache/replay-spike/public",
  load = (p) => Bun.file(`${base}/${p}`).bytes(),
  profile = await Bun.file(`${base}/decoder-16.21-macos/profile.json`).json(),
  manifestBytes = await load("latest-effects/manifest.json"),
  bytes = await load("latest-negative-form-prefix/package.json"),
  policy = await createLatestNegativeFormPrefix({
    profile,
    packageBytes: bytes,
    effectsManifestBytes: manifestBytes,
  }),
  hero = {
    kind: "hero-creation-candidate",
    entityId: 1,
    champion: "Akshan",
    skinId: 20,
    provenance: {
      time: 0,
      stream: 2,
      chunkId: 1,
      transportSequence: 10,
      entryOrder: 0,
    },
  },
  request = (o = {}) => ({
    id: "resource-request:20:0",
    origin: "network",
    opcode: 129,
    entityId: 1,
    time: 0,
    transportSequence: 20,
    entryOrder: 0,
    stream: 2,
    chunkId: 1,
    blockOffset: 8,
    status: "unit-form-selection-request",
    index: 255,
    signedIndex: -1,
    nativeFlag: false,
    acceptedByLiveUnit: null,
    resourceIdentity: null,
    ...o,
  }),
  report = (rs) => ({
    build: profile.clientVersion,
    protocol: profile.protocolDigest,
    heroes: [structuredClone(hero)],
    resourceRequests: rs,
  }),
  setup = (rs) =>
    loadLatestInitialResourcePrefix({
      profile,
      load,
      manifestBytes,
      report: report(rs),
    }),
  cursor = (transportSequence, exclusive = false) => ({
    transportSequence,
    entryOrder: 0,
    exclusive,
  });

test("exact installed submesh-only gear capability preserves identities without accepting or restoring snapshots", () => {
  const observed = request(),
    result = policy.classify(hero, observed);
  expect(isLatestNegativeFormPrefix(policy)).toBe(true);
  expect(isLatestNegativeFormPrefix({ ...policy })).toBe(false);
  expect(result.resourceIdentityPreserved).toBe(true);
  expect(result.rigIdentityPreserved).toBe(true);
  expect(result.submeshVisibilityPreserved).toBe(false);
  expect(result.snapshotTreatment).toBe(
    "snapshot-observation-consistent-with-conditional-initial-prefix",
  );
  expect(result.nativeSnapshotRestoration).toBeNull();
  expect(result.nativeSnapshotAcceptance).toBeNull();
  expect(result.nativeAcceptance).toBeNull();
  expect(result.nativePoseParity).toBeNull();
  observed.index = 0;
  expect(result.request.index).toBe(255);
  expect(Object.isFrozen(result.request)).toBe(true);
});

test("unsupported appearance, flag, positive form, copy and foreign identity remain invalidators", () => {
  for (const h of [
    { ...hero, skinId: 0 },
    { ...hero, skinId: "20" },
    { ...hero, champion: "Viego" },
  ])
    expect(policy.classify(h, request())).toBeNull();
  for (const r of [
    request({ nativeFlag: true }),
    request({ index: 0, signedIndex: 0 }),
    request({ entityId: 2 }),
    request({ opcode: 965, status: "appearance-stack-request", kind: "copy" }),
  ])
    expect(policy.classify(hero, r)).toBeNull();
  expect(() =>
    policy.classify(hero, request({ acceptedByLiveUnit: true })),
  ).toThrow("unaccepted status");
  expect(() => policy.classify(hero, request({ stream: 3 }))).toThrow(
    "provenance",
  );
});

test("negative observations retain causal source IDs across both streams and backwards queries", async () => {
  const second = request({
      time: 60,
      transportSequence: 30,
      id: "resource-request:30:0",
      chunkId: 2,
    }),
    { policy: p } = await setup([request(), second]);
  expect(
    p.query(1, 0, cursor(20, true)).prefixPreservingRequestObservations,
  ).toEqual([]);
  const first = p.query(1, 0, cursor(20));
  expect(first.stack).not.toBeNull();
  expect(
    first.prefixPreservingRequestObservations.map((o) => o.sourceEventId),
  ).toEqual(["resource-request:20:0"]);
  expect(
    p
      .query(1, 69)
      .prefixPreservingRequestObservations.map((o) => o.request.stream),
  ).toEqual([2, 2]);
  expect(p.query(1, 69).stack.base).toEqual(first.stack.base);
  expect(p.query(1, 1)).toEqual(first);
  const game = await setup([request({ stream: 1, chunkId: 0 })]);
  expect(
    game.policy.query(1, 1).prefixPreservingRequestObservations[0]
      .snapshotTreatment,
  ).toBeNull();
});

test("neither later negative snapshot nor backward seeking renews an earlier invalidated prefix", async () => {
  const invalidator = request({
      time: 1,
      transportSequence: 25,
      id: "resource-request:25:0",
      index: 0,
      signedIndex: 0,
      stream: 1,
    }),
    later = request({
      time: 60,
      transportSequence: 30,
      id: "resource-request:30:0",
      chunkId: 2,
    }),
    { policy: p } = await setup([request(), invalidator, later]);
  expect(p.query(1, 1, cursor(25, true)).stack).not.toBeNull();
  expect(p.query(1, 1, cursor(25)).stack).toBeNull();
  expect(p.query(1, 99).blockingRequest.id).toBe(invalidator.id);
  expect(p.query(1, 0, cursor(20)).stack).not.toBeNull();
  expect(p.query(1, 99).stack).toBeNull();
});

test("package, manifest and build identity must match exactly", async () => {
  const corrupt = bytes.slice();
  corrupt[20] ^= 1;
  await expect(
    createLatestNegativeFormPrefix({
      profile,
      packageBytes: corrupt,
      effectsManifestBytes: manifestBytes,
    }),
  ).rejects.toThrow("Pinned");
  await expect(
    createLatestNegativeFormPrefix({
      profile: { ...profile, clientVersion: "other" },
      packageBytes: bytes,
      effectsManifestBytes: manifestBytes,
    }),
  ).rejects.toThrow("Unsupported");
  await expect(
    createLatestNegativeFormPrefix({
      profile,
      packageBytes: bytes,
      effectsManifestBytes: new TextEncoder().encode("{} "),
    }),
  ).rejects.toThrow("Unsupported");
});
