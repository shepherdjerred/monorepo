import { test, expect } from "bun:test";
import {
  createLatestPositiveFormResourcePrefix,
  isLatestPositiveFormResourcePrefix,
  isLatestPositiveFormResourceTrack,
} from "./latest-positive-form-resource-prefix.mjs";
const cache = new URL("../../../../.cache/replay-spike/", import.meta.url),
  file = (path) => Bun.file(new URL(path, cache)),
  profile = await file("public/decoder-16.21-macos/profile.json").json(),
  packageBytes = await file(
    "public/latest-positive-form-resource-prefix/package.json",
  ).bytes(),
  effectsManifestBytes = await file(
    "public/latest-effects/manifest.json",
  ).bytes(),
  gearPackageBytes = await file(
    "public/latest-unit-gear-resources/package.json",
  ).bytes(),
  report = (await file("research/viewer-root-reconstruction.json").json())
    .report,
  manifest = JSON.parse(new TextDecoder().decode(effectsManifestBytes)),
  inputs = { profile, packageBytes, effectsManifestBytes, gearPackageBytes },
  owner = await createLatestPositiveFormResourcePrefix(inputs),
  entityId = 1073741892,
  cursor = (transportSequence, exclusive = false) => ({
    transportSequence,
    entryOrder: 0,
    exclusive,
  });

test("all12 actual projectile references use explicit causal gear0 publication with omissions", () => {
  const before = JSON.stringify(report),
    track = owner.createTrack(report),
    actor = manifest.actors["champions/katarina/29"],
    packets = report.missiles.filter(
      (row) =>
        row.cast.ownerId === entityId && row.time >= 69 && row.time <= 99,
    );
  expect(isLatestPositiveFormResourcePrefix(owner)).toBe(true);
  expect(isLatestPositiveFormResourceTrack(track)).toBe(true);
  expect(packets).toHaveLength(12);
  for (const packet of packets) {
    const key = parseInt(
        actor.missiles[packet.cast.spellHash].effectKey.slice(1, -1),
        16,
      ),
      result = track.lookup(
        entityId,
        packet.time,
        key,
        cursor(packet.transportSequence, true),
      );
    expect(result.status).toBe("matched-authored-gear-reference");
    expect(result.selectedGearIndex).toBe(0);
    expect(result.publication.id).toBe("resource-request:5701:0");
    expect(result.sourceEventIds).toContain("resource-request:25566:0");
    expect(result.nativeAcceptance).toBeNull();
    expect(result.nativeSnapshotRestoration).toBeNull();
    expect(result.omissions).toContain(
      "form:native-model-table-and-render-readiness-unrecovered",
    );
  }
  expect(track.lookup(entityId, 72, 0xc6e4f072).referenceToken).toBe(
    0xa69ca032,
  );
  expect(track.lookup(entityId, 72, 0x022a3498).referenceToken).toBe(
    0xe1e1e458,
  );
  expect(track.lookup(entityId, 72, 0x2f8d77b5).referenceToken).toBe(
    0xcb98ec75,
  );
  expect(JSON.stringify(report)).toBe(before);
});
test("publication ordering, backward queries and unknown older-stack keys stay exact", () => {
  const track = owner.createTrack(report);
  expect(track.query(entityId, 0, cursor(5701, true)).status).toBe(
    "unresolved-positive-resource-prefix",
  );
  expect(track.query(entityId, 0, cursor(5701)).selectedGearIndex).toBe(0);
  const event = report.resourceRequests.find(
    (row) => row.id === "resource-request:50542:0",
  );
  expect(
    track.query(entityId, event.time, cursor(50542, true)).selectedGearIndex,
  ).toBe(0);
  expect(
    track.query(entityId, event.time, cursor(50542)).selectedGearIndex,
  ).toBe(2);
  const before = track.query(entityId, 72);
  track.query(entityId, 98);
  expect(track.query(entityId, 72)).toEqual(before);
  expect(track.lookup(entityId, 72, 0xdeadbeef)).toMatchObject({
    status: "unresolved-positive-resource-prefix",
    reason: "form:older-stack-unrecovered-for-absent-top-gear-key",
  });
  expect(track.lookup(entityId, 72, 0).reason).toBe(
    "form:alternate-name-resource-path-unrecovered",
  );
  expect(() => track.query(entityId, 100)).toThrow("cursor");
  expect(() =>
    track.query(entityId, 72, { transportSequence: -1, entryOrder: 0 }),
  ).toThrow("cursor");
});
test("unknown appearance mutations and unsupported gear indices are sticky invalidators", () => {
  const changed = structuredClone(report),
    sample = report.resourceRequests.find((row) => row.opcode === 984);
  changed.resourceRequests.push({
    ...structuredClone(sample),
    entityId,
    time: 80,
    transportSequence: 40000,
    id: "resource-request:40000:0",
    stream: 1,
  });
  const track = owner.createTrack(changed);
  expect(track.query(entityId, 79).selectedGearIndex).toBe(0);
  expect(track.query(entityId, 98)).toMatchObject({
    status: "unresolved-positive-resource-prefix",
    reason: "form:unsupported-intervening-resource-request",
    blockingRequest: { id: "resource-request:40000:0" },
  });
  const unsupported = structuredClone(report);
  Object.assign(
    unsupported.resourceRequests.find(
      (row) => row.id === "resource-request:5701:0",
    ),
    { index: 1, signedIndex: 1 },
  );
  expect(owner.createTrack(unsupported).query(entityId, 98).reason).toBe(
    "form:positive-request-index-unproven",
  );
});
test("snapshot observations cannot invent, replace or renew selected resource state", () => {
  const mismatch = structuredClone(report);
  Object.assign(
    mismatch.resourceRequests.find(
      (row) => row.id === "resource-request:25566:0",
    ),
    { index: 2, signedIndex: 2 },
  );
  expect(owner.createTrack(mismatch).query(entityId, 98).reason).toBe(
    "form:snapshot-prefix-without-matching-causal-publication",
  );
  const absent = structuredClone(report);
  absent.resourceRequests = absent.resourceRequests.filter(
    (row) => row.id !== "resource-request:5701:0",
  );
  expect(owner.createTrack(absent).query(entityId, 72).reason).toBe(
    "form:snapshot-prefix-without-matching-causal-publication",
  );
});
test("package forgeries and duplicate request identities cannot mint capabilities", async () => {
  expect(isLatestPositiveFormResourcePrefix({ ...owner })).toBe(false);
  for (const key of [
    "packageBytes",
    "effectsManifestBytes",
    "gearPackageBytes",
  ]) {
    const bytes = inputs[key].slice();
    bytes[0] ^= 1;
    await expect(
      createLatestPositiveFormResourcePrefix({ ...inputs, [key]: bytes }),
    ).rejects.toThrow();
  }
  const changed = structuredClone(report);
  changed.resourceRequests.push(structuredClone(changed.resourceRequests[0]));
  expect(() => owner.createTrack(changed)).toThrow("Duplicate");
});
