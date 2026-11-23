import { expect, test } from "bun:test";
import {
  originalVfxBodyInputIdentity,
  matchOriginalVfxBodies,
} from "./scene-vfx-body-identity.mjs";
const entry = () => ({
  effectId: "world/example/0/00000001",
  emitterIndex: 0,
  kind: "complex",
  classHash: "09cde442",
  ownerPathHash: "00000001",
  definitionSha256: "a".repeat(64),
  binSha256: "b".repeat(64),
  binFile: "old-location.bin",
  fields: [
    { fieldHash: "00000002", offset: 20, bytes: 8, sha256: "c".repeat(64) },
  ],
});
test("scene/file wrappers cannot change an exact native body identity", () => {
  const before = entry(),
    after = {
      ...before,
      binFile: "new-location.bin",
      sceneManifestSha256: "d".repeat(64),
    };
  expect(originalVfxBodyInputIdentity(before)).toBe(
    originalVfxBodyInputIdentity(after),
  );
});
test("any actual source/owner/annotation/ordered field change prevents reuse", () => {
  for (const change of [
    (value) => (value.binSha256 = "d".repeat(64)),
    (value) => (value.definitionSha256 = "d".repeat(64)),
    (value) => (value.ownerPathHash = "00000003"),
    (value) => (value.effectId = "world/other/0/00000001"),
    (value) => value.fields[0].offset++,
    (value) => (value.fields[0].sha256 = "d".repeat(64)),
  ]) {
    const before = entry(),
      after = entry();
    change(after);
    expect(originalVfxBodyInputIdentity(before)).not.toBe(
      originalVfxBodyInputIdentity(after),
    );
  }
});
test("a new wrapper preserves original native record lineage and leaves new inputs missing", () => {
  const input = entry(),
    oldInputs = {
      build: "16.21.829.8620",
      protocol: "20e09df23c66b85e",
      emitters: [input],
    },
    record = {
      inputIndex: 0,
      effectId: input.effectId,
      emitterIndex: 0,
      sourceDefinitionSha256: input.definitionSha256,
      sourceBinSha256: input.binSha256,
      kind: input.kind,
      classHash: input.classHash,
    },
    oldAuthority = {
      build: oldInputs.build,
      protocol: oldInputs.protocol,
      nativeSpectatorAdmitted: false,
      scope: {
        completeInputInventory: true,
        fullPristineMathInitializer: true,
      },
      emitters: [record],
    },
    result = matchOriginalVfxBodies({
      oldInputs,
      oldAuthority,
      newInputs: {
        ...oldInputs,
        emitters: [entry(), { ...entry(), definitionSha256: "d".repeat(64) }],
      },
    });
  expect(result.reused[0].originalInputIndex).toBe(0);
  expect(result.reused[0].record).toBe(record);
  expect(result.missing).toEqual([1]);
});
