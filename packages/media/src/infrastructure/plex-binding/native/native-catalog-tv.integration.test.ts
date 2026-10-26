import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeCompensationFixture } from "#automation/native-compensation/test-fixture.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import {
  NativePlexObservationSchema,
  type NativePlexObservation,
} from "#shared/plex-binding/native.ts";
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
      fileFactory: () => sharedTvFileFixture(db, mappedPublicationFixture),
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
      { serverMachineId: "server", sectionId: "2", sectionType: "show" },
    ],
  });
  const start = Date.now();
  // External metadata is synthetic; the two-leaf group and interrupted scope use actual producers.
  observation = NativePlexObservationSchema.parse({
    purpose: "native_review",
    parent: parent.proofParent,
    present: [],
    absent: [],
    compensationCatalog: entries.map((entry) => ({
      ...entry,
      items: entry.targets.map((target, index) => {
        if (target.kind !== "episode")
          throw new Error("Actual shared TV target missing");
        const ratingKey = String(index + 1);
        return {
          kind: "episode",
          scope: target.scope,
          sectionId: "2",
          item: {
            type: "episode",
            ratingKey,
            guids: [],
            media: [{ parts: [{ id: "101", file: entry.canonicalPath }] }],
          },
          hierarchy: {
            episode: {
              ratingKey,
              parentRatingKey: "201",
              grandparentRatingKey: "301",
              index: target.coordinate.episodeNumber,
              parentIndex: target.coordinate.seasonNumber,
            },
            season: {
              ratingKey: "201",
              type: "season",
              index: target.coordinate.seasonNumber,
              parentRatingKey: "301",
              sectionId: "2",
            },
            show: {
              ratingKey: "301",
              type: "show",
              guids: target.references
                .map((ref) => `${ref.namespace}://${ref.value}`)
                .sort(),
              sectionId: "2",
            },
          },
        };
      }),
    })),
    verification: {
      startedAt: new Date(start).toISOString(),
      completedAt: new Date(start + 1).toISOString(),
      expiresAt: new Date(start + 60_000).toISOString(),
      sections: [{ sectionId: "2", sectionType: "show" }],
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
  if (entry === undefined || item?.kind !== "episode")
    throw new Error("Actual shared episode fixture missing");
  return { entry, item };
}
test("complete shared TV catalog or complete absence preserves both physical candidates", () => {
  expect(first(observation).entry.items).toHaveLength(2);
  expect(() => assertProof(observation)).not.toThrow();
  const absent = structuredClone(observation);
  first(absent).entry.items = [];
  expect(() => assertProof(absent)).not.toThrow();
  expect(
    first(observation).entry.compatiblePhysicalCandidates.map(
      (value) => value.role,
    ),
  ).toEqual(["predecessor", "successor"]);
});
test("foreign show GUID cannot authorize matching episode coordinates and path", () => {
  const wrongShow = structuredClone(observation);
  first(wrongShow).item.hierarchy.show.guids = ["tmdb://999999999999"];
  expect(() => assertProof(wrongShow)).toThrow(
    "episode/season/show chain changed",
  );
});
test("emitted episode, season and show sections each belong to the configured section", () => {
  for (const level of ["episode", "season", "show"] as const) {
    const foreign = structuredClone(observation);
    const { item } = first(foreign);
    if (level === "episode") item.sectionId = "999";
    else item.hierarchy[level].sectionId = "999";
    expect(() => assertProof(foreign)).toThrow();
  }
});
test("partial and duplicate per-target observations cannot authorize a shared physical group", () => {
  const partial = structuredClone(observation);
  first(partial).entry.items.pop();
  expect(() => assertProof(partial)).toThrow();
  const duplicate = structuredClone(observation);
  const { entry, item } = first(duplicate);
  entry.items[1] = structuredClone(item);
  expect(() => assertProof(duplicate)).toThrow();
});
