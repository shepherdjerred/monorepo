import { beforeAll, afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeCompensationFixture } from "#automation/native-compensation/test-fixture.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import {
  NativePlexObservationSchema,
  type NativePlexObservation,
} from "#shared/plex-binding/native.ts";
import { NativeCompensationScopeSchema } from "#shared/native-recovery/compensation.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { loadNativePlexReviewParent } from "./native-parent.ts";
import { readNativePlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import {
  nativeCompensationCatalogExpected,
  assertNativeCompensationCatalog,
} from "./native-catalog.ts";

const harness = automationTestHarness();
let directory: string | undefined;
let rawScope: unknown;
let observation: NativePlexObservation;
beforeAll(async () => {
  const db = harness.database();
  const fixture = await nativeCompensationFixture(
    db,
    harness.context().cipher,
    {
      fileFactory: async () => {
        const file = await mappedPublicationFixture(db);
        let originalBytes: number | undefined;
        return {
          ...file,
          published: async () => {
            const published = await file.published();
            originalBytes = Buffer.byteLength(published.content);
            return published;
          },
          acquisition: () => {
            if (originalBytes === undefined)
              throw new Error("Original actual publication is missing");
            return file.acquisition("D".repeat(originalBytes));
          },
        };
      },
    },
  );
  directory = fixture.file.directory;
  const parent = await loadNativePlexReviewParent(db, fixture.input);
  rawScope = parent.rawScope;
  const targets = await readNativePlexCanonicalTargets(db, parent.parent.scope);
  const entries = nativeCompensationCatalogExpected({
    rawScope,
    scopeHash: parent.proofParent.scopeHash,
    canonicalTargets: targets,
    access: [
      { serverMachineId: "server", sectionId: "1", sectionType: "movie" },
    ],
  });
  const start = Date.now();
  // Synthetic wire metadata is separate from the real interrupted publication/scope above.
  observation = NativePlexObservationSchema.parse({
    purpose: "native_review",
    parent: parent.proofParent,
    present: [],
    absent: [],
    compensationCatalog: entries.map((entry) => ({
      ...entry,
      items: entry.targets.map((target, index) => ({
        kind: "movie",
        scope: target.scope,
        sectionId: entry.access.sectionId,
        item: {
          type: "movie",
          ratingKey: String(index + 1),
          guids: target.references
            .map((ref) => `${ref.namespace}://${ref.value}`)
            .sort(),
          media: [{ parts: [{ id: "101", file: entry.canonicalPath }] }],
        },
      })),
    })),
    verification: {
      startedAt: new Date(start).toISOString(),
      completedAt: new Date(start + 1).toISOString(),
      expiresAt: new Date(start + 60_000).toISOString(),
      sections: [{ sectionId: "1", sectionType: "movie" }],
      passes: [
        {
          itemCount: targets.length,
          inventoryHash: identityHash(entries),
          selectedHash: identityHash(targets),
        },
        {
          itemCount: targets.length,
          inventoryHash: identityHash(entries),
          selectedHash: identityHash(targets),
        },
      ],
    },
  });
});
afterAll(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
});
function assertProof(value: NativePlexObservation) {
  assertNativeCompensationCatalog({
    rawScope,
    scopeHash: observation.parent.scopeHash,
    observation: value,
  });
}
function first(value: NativePlexObservation) {
  const entry = value.compensationCatalog?.[0];
  const item = entry?.items[0];
  if (entry === undefined || item === undefined)
    throw new Error("Actual compensation catalog fixture missing");
  return { entry, item, part: item.item.media[0].parts[0] };
}
test("actual interrupted scope retains both candidates with absent, C-sized or D-sized Part metadata", () => {
  const scope = NativeCompensationScopeSchema.parse(rawScope);
  const original = scope.entries[0];
  if (original?.predecessor == null)
    throw new Error("Actual predecessor missing");
  expect(original.predecessor.sizeBytes).toBe(original.entry.sizeBytes);
  expect(original.predecessor.checksum).not.toBe(original.entry.checksum);
  expect(() => assertProof(observation)).not.toThrow();
  const candidates = first(observation).entry.compatiblePhysicalCandidates;
  expect(candidates.map((value) => value.assetId)).toEqual([
    original.predecessor.id,
    original.entry.assetId,
  ]);
  for (const size of [
    original.predecessor.sizeBytes,
    original.entry.sizeBytes,
  ]) {
    const sized = structuredClone(observation);
    first(sized).part.sizeBytes = size;
    expect(() => assertProof(sized)).not.toThrow();
    expect(first(sized).entry.compatiblePhysicalCandidates).toEqual(candidates);
  }
});
test("movie catalog rejects wrong canonical GUID, foreign emitted section and third Part size", () => {
  const wrongGuid = structuredClone(observation);
  first(wrongGuid).item.item.guids = ["tmdb://999999999999"];
  expect(() => assertProof(wrongGuid)).toThrow(
    "movie canonical references changed",
  );
  const wrongSection = structuredClone(observation);
  first(wrongSection).item.sectionId = "999";
  expect(() => assertProof(wrongSection)).toThrow("item section changed");
  const thirdSize = structuredClone(observation);
  const scope = NativeCompensationScopeSchema.parse(rawScope);
  const entry = scope.entries[0];
  if (entry?.predecessor == null) throw new Error("Actual predecessor missing");
  first(thirdSize).part.sizeBytes = String(
    BigInt(entry.entry.sizeBytes) + BigInt(entry.predecessor.sizeBytes) + 1n,
  );
  expect(() => assertProof(thirdSize)).toThrow(
    "neither allowed physical candidate",
  );
});
test("complete absence remains catalog-only evidence while duplicate movie claims are rejected", () => {
  const absent = structuredClone(observation);
  first(absent).entry.items = [];
  expect(() => assertProof(absent)).not.toThrow();
  const duplicate = structuredClone(observation);
  first(duplicate).entry.items.push(structuredClone(first(duplicate).item));
  expect(() => assertProof(duplicate)).toThrow();
});
test("catalog evidence rejects foreign candidate, altered raw ref and foreign path", () => {
  const foreign = structuredClone(observation);
  first(foreign).entry.compatiblePhysicalCandidates[1].assetId =
    crypto.randomUUID();
  expect(() => assertProof(foreign)).toThrow("candidate references changed");
  const changedHash = structuredClone(observation);
  first(changedHash).entry.compatiblePhysicalCandidates[0].sourceHash =
    "a".repeat(64);
  expect(() => assertProof(changedHash)).toThrow(
    "candidate references changed",
  );
  const moved = structuredClone(observation);
  first(moved).part.file += ".foreign";
  expect(() => assertProof(moved)).toThrow();
});
test("compensation schema requires catalog-only proof and cannot parse as ordinary present authority", () => {
  const { compensationCatalog: _catalog, ...missing } = observation;
  expect(NativePlexObservationSchema.safeParse(missing).success).toBe(false);
  const wrongPurpose = {
    ...observation,
    parent: { ...observation.parent, lifecycleKind: "published" },
  };
  expect(NativePlexObservationSchema.safeParse(wrongPurpose).success).toBe(
    false,
  );
});
