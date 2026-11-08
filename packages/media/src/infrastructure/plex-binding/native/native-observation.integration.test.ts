import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeArchiveFixture } from "#automation/native-archive/test-fixture.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { loadNativePlexReviewParent } from "./native-parent.ts";
import { nativeBudgetObservation } from "./native-budget.test-support.ts";
import { assertNativePlexObservation } from "./native-observation.ts";

const harness = automationTestHarness();
let directory: string | undefined;
let input: Parameters<typeof assertNativePlexObservation>[0];
let proof: Awaited<ReturnType<typeof nativeBudgetObservation>>;

beforeAll(async () => {
  const db = harness.database();
  const fixture = await nativeArchiveFixture(db, harness.context().cipher, {
    chain: 2,
    fileFactory: () => mappedPublicationFixture(db),
  });
  directory = fixture.file.directory;
  await fixture.observe();
  const parent = await loadNativePlexReviewParent(db, fixture.prepareInput);
  proof = await nativeBudgetObservation(db, parent.proofParent);
  const plan = await db.nativeRecoveryPlan.findUniqueOrThrow({
    where: { id: parent.proofParent.planId },
  });
  input = {
    rawScope: plan.scope,
    rawObservation: proof.observation,
    network: proof.network,
  };
});
afterAll(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
});

test("actual archive review binds whole playback and absence groups with recorded canonical targets", () => {
  const result = assertNativePlexObservation(input);
  expect(result.observation.present.length).toBeGreaterThan(0);
  expect(result.observation.absent.length).toBeGreaterThan(0);
  expect(result.targets.length).toBeGreaterThan(0);
});

test("native proof rejects missing and duplicate playback coverage", () => {
  const first = proof.observation.present[0];
  if (first === undefined) throw new Error("Fixture playback missing");
  for (const present of [[], [...proof.observation.present, first]])
    expect(() =>
      assertNativePlexObservation({
        ...input,
        rawObservation: { ...proof.observation, present },
      }),
    ).toThrow("coverage changed");
});

test("native proof rejects foreign physical version, checksum and canonical path", () => {
  const first = proof.observation.present[0];
  if (first === undefined) throw new Error("Fixture playback missing");
  for (const group of [
    { ...first.group, assetVersion: first.group.assetVersion + 1 },
    { ...first.group, checksum: "f".repeat(64) },
    { ...first.group, canonicalPath: "/data/movies/foreign.mkv" },
  ]) {
    const present = [
      {
        ...first,
        group,
        item: {
          ...first.item,
          media: [
            {
              parts: [
                { ...first.item.media[0].parts[0], file: group.canonicalPath },
              ],
            },
          ],
        },
      },
    ];
    expect(() =>
      assertNativePlexObservation({
        ...input,
        rawObservation: { ...proof.observation, present },
      }),
    ).toThrow("physical or canonical identity changed");
  }
});

test("native proof rejects foreign canonical GUID and paired section", () => {
  const first = proof.observation.present[0];
  if (first === undefined) throw new Error("Fixture playback missing");
  const wrongGuid = {
    ...first,
    item: { ...first.item, guids: ["tmdb://999999999"] },
  };
  expect(() =>
    assertNativePlexObservation({
      ...input,
      rawObservation: { ...proof.observation, present: [wrongGuid] },
    }),
  ).toThrow("references changed");
  const wrongSection = {
    ...first,
    access: { ...first.access, sectionId: "99999" },
  };
  expect(() =>
    assertNativePlexObservation({
      ...input,
      rawObservation: { ...proof.observation, present: [wrongSection] },
    }),
  ).toThrow("Network projection changed");
});

test("native proof rejects omitted, extra and partial absence paths", () => {
  const first = proof.observation.absent[0];
  if (first === undefined) throw new Error("Fixture absence missing");
  const variants = [
    [],
    [...proof.observation.absent, first],
    [
      {
        ...first,
        canonicalPaths: [...first.canonicalPaths, "/data/movies/foreign.mkv"],
      },
    ],
  ];
  for (const absent of variants)
    expect(() =>
      assertNativePlexObservation({
        ...input,
        rawObservation: { ...proof.observation, absent },
      }),
    ).toThrow("absence closure changed");
});

test("native proof hashes the literal original scope before parsing it", () => {
  expect(() =>
    assertNativePlexObservation({
      ...input,
      rawScope: { scope: input.rawScope },
    }),
  ).toThrow("original scope hash changed");
});
