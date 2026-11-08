import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { createLatestDirectEffectPlacement } from "./latest-direct-effect-placement.mjs";
import { EFFECT_ENTITY_FIELDS } from "./latest-world-presentation.mjs";
import {
  createLatestAdditionalAudioAnchorPolicy,
  ADDITIONAL_AUDIO_ANCHOR_POLICY,
  ADDITIONAL_AUDIO_ANCHOR_BLOCKS,
} from "./latest-additional-audio-anchor.mjs";
import { sha256 } from "./structural-comparison.mjs";
import {
  PROVIDER_FREE_BOUND_SIZE_BLOCKS,
  PROVIDER_FREE_BOUND_SIZE_STATUS,
  createLatestProviderFreeBoundSize,
} from "./latest-provider-free-bound-size.mjs";

const cache = resolve(
  import.meta.dir,
  "../../../../.cache/replay-spike/public",
);
const profile = await Bun.file(
  `${cache}/decoder-16.21-macos/profile.json`,
).json();
const placement = await createLatestDirectEffectPlacement({
  profile,
  packageBytes: await Bun.file(
    `${cache}/latest-world-descriptor-abi/package.json`,
  ).bytes(),
});
const descriptor = {
  resourceContextEntityId: 10,
  attachmentEntityId: 0,
  lookup14EntityId: 0,
  lookupA8EntityId: 20,
  flags: 32,
  field8c: 0,
  attachmentKey4c: 0,
  attachmentKey50: 0,
  byteFields: { field98: 0 },
  coordinateSpace: "native-world",
  packetVectorsResolved: true,
  primaryPacketPosition: [11, 2, 33],
  secondaryPacketVector: [44, 5, 66],
  vector6c: [0, 0, 0],
};
const references = (d, entityClass = "champion") =>
  EFFECT_ENTITY_FIELDS.map((field) => ({
    field,
    entityId: d[field],
    status: d[field] ? "registered" : "native-null",
    entity: d[field]
      ? { entityId: d[field], entityClass, position: null }
      : null,
  }));
function invoke(d = descriptor, refs = references(d)) {
  return placement.resolve({ event: { descriptor: d }, references: refs });
}

test("pins exact original additional-provider factory setter and audio consumer", async () => {
  const image = await Bun.file(
    `${cache}/decoder-16.21-macos/image.bin`,
  ).bytes();
  expect(await sha256(image)).toBe(profile.decoderImageSha256);
  for (const [at, size, digest] of ADDITIONAL_AUDIO_ANCHOR_BLOCKS)
    expect(await sha256(image.subarray(at, at + size))).toBe(digest);
  for (const [at, size, digest] of PROVIDER_FREE_BOUND_SIZE_BLOCKS)
    expect(await sha256(image.subarray(at, at + size))).toBe(digest);
  expect(() =>
    createLatestProviderFreeBoundSize({ ...profile, clientVersion: "other" }),
  ).toThrow("Exact provider-free");
  expect(() =>
    createLatestAdditionalAudioAnchorPolicy({
      ...profile,
      decoderImageSha256: "different",
    }),
  ).toThrow("Exact additional");
  expect(() =>
    createLatestAdditionalAudioAnchorPolicy(profile).inspect({
      field: "lookupA8EntityId",
      entityId: 0x100000000,
      status: "registered",
      entity: { entityId: 0x100000000, entityClass: "champion" },
    }),
  ).toThrow("Registered auxiliary");
});

test("retains all four identities and packet basis without querying auxiliary pose", () => {
  const refs = references(descriptor);
  Object.defineProperty(refs[3].entity, "position", {
    get() {
      throw Error("Pose must not be read");
    },
  });
  const result = invoke(descriptor, refs);
  expect(result.resolved).toBe(true);
  expect(result.references).toBe(refs);
  expect(result.policy).toBe(ADDITIONAL_AUDIO_ANCHOR_POLICY);
  expect(result.boundObjectSize).toBe(0);
  expect(result.boundObjectSizeStatus).toBe(PROVIDER_FREE_BOUND_SIZE_STATUS);
  expect(result.position).toEqual([11, 2, 33]);
  expect(result.secondaryPosition).toEqual([44, 5, 66]);
  expect(result.basis).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  expect(result.reasons).toContain(
    "audio:auxiliary-provider-anchor-getters-omitted",
  );
  expect(result.reasons).toContain(
    "lifecycle:auxiliary-provider-shared-and-weak-ownership-omitted",
  );
});

test("unknown inactive or unproven auxiliary classes remain blocked", () => {
  for (const status of ["unresolved", "inactive"]) {
    const refs = references(descriptor);
    refs[3] = { ...refs[3], status, entity: null };
    const result = invoke(descriptor, refs);
    expect(result.resolved).toBe(false);
    expect(result.reasons).toContain(
      `world:${status}-reference:lookupA8EntityId:20`,
    );
  }
  for (const kind of [
    "npc",
    "projectile",
    "building",
    "lane-minion",
    "unknown",
  ]) {
    const result = invoke(descriptor, references(descriptor, kind));
    expect(result.resolved).toBe(false);
    expect(result.reasons).toContain(
      `world:additional-provider-class-unproven:${kind}`,
    );
  }
});

test("auxiliary audio policy never supplies a missing source target or special transform", () => {
  for (const patch of [
    { attachmentEntityId: 10 },
    { lookup14EntityId: 10 },
    { byteFields: { field98: 1 } },
    { flags: 64 },
    { field8c: 1 },
  ]) {
    const d = { ...descriptor, ...patch };
    expect(invoke(d).resolved).toBe(false);
  }
  const refs = references(descriptor);
  refs[3].entity.entityId = 21;
  expect(() => invoke(descriptor, refs)).toThrow("inconsistent world identity");
});

test("combines only independently verified horizontal packet direction", () => {
  const result = invoke({ ...descriptor, vector6c: [0.6, 0, 0.8] });
  expect(result.resolved).toBe(true);
  expect(result.policy).toBe(ADDITIONAL_AUDIO_ANCHOR_POLICY);
  expect(result.basisStatus).toBe(
    "original-provider-free-horizontal-packet-direction-basis",
  );
  expect(invoke({ ...descriptor, vector6c: [0.6, 0.1, 0.8] }).resolved).toBe(
    false,
  );
  expect(invoke({ ...descriptor, lookupA8EntityId: 0 }).policy).toBe(
    "packet-position-without-transform-providers",
  );
});
