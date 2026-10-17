import { afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { nativeArchiveFixture } from "#automation/native-archive/test-fixture.ts";
import { NativeArchiveNetworkEvidenceSchema } from "#shared/native-recovery/archive.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const value = await nativeArchiveFixture(
    harness.database(),
    harness.context().cipher,
  );
  directories.push(value.file.directory);
  return value;
}
test("actual A→B→C observation proves current C, every archive absence and sessions last", async () => {
  const f = await fixture();
  const calls: string[] = [];
  const page = f.observerContext.plex.libraryPage;
  f.observerContext.plex.libraryPage = async (...args) => {
    calls.push("inventory");
    return await page(...args);
  };
  f.observerContext.plex.activeSessions = () => {
    calls.push("sessions");
    return Promise.resolve([]);
  };
  await f.observe();
  const observation = await harness
    .database()
    .nativeRecoveryObservation.findFirstOrThrow({
      where: { planId: f.planId, kind: "network" },
    });
  const evidence = NativeArchiveNetworkEvidenceSchema.parse(
    observation.evidence,
  );
  expect(evidence.plex.currentPlayback.map((item) => item.assetId)).toEqual([
    f.publications[2]?.entry.assetId,
  ]);
  expect(
    evidence.plex.archiveAbsence.map((item) => item.assetId).sort(),
  ).toEqual(
    f.publications
      .slice(0, 2)
      .map((item) => item.entry.assetId)
      .sort(),
  );
  expect(calls.at(-1)).toBe("sessions");
  expect(evidence.plex.playback.state).toBe("clear");
});
test.each([
  "missing_current",
  "archive_indexed",
  "changed_inventory",
  "playing",
] as const)(
  "fresh Plex %s protects without persisting successful evidence",
  async (mode) => {
    const f = await fixture();
    const page = f.observerContext.plex.libraryPage;
    let reads = 0;
    f.observerContext.plex.libraryPage = async (...args) => {
      const result = await page(...args);
      reads++;
      if (mode === "missing_current") return { items: [], total: 0 };
      if (mode === "archive_indexed") {
        const archived = await harness
          .database()
          .libraryAsset.findUniqueOrThrow({
            where: { id: z.uuid().parse(f.publications[0]?.entry.assetId) },
          });
        const source = result.items[0];
        if (source === undefined)
          throw new Error("Fixture current Plex item missing");
        return {
          items: [
            ...result.items,
            {
              ...source,
              ratingKey: "archived",
              Media: [{ Part: [{ id: 2, file: archived.path }] }],
            },
          ],
          total: result.total + 1,
        };
      }
      if (mode === "changed_inventory" && reads === 2)
        return {
          ...result,
          items: result.items.map((item) => ({
            ...item,
            ratingKey: `changed-${item.ratingKey}`,
          })),
        };
      return result;
    };
    if (mode === "playing")
      f.observerContext.plex.activeSessions = async () => {
        const current = await harness
          .database()
          .libraryAsset.findUniqueOrThrow({
            where: { id: z.uuid().parse(f.publications.at(-1)?.entry.assetId) },
          });
        return [
          {
            ratingKey: "active",
            type: "movie",
            title: "Synthetic active movie",
            Media: [{ Part: [{ id: 1, file: current.path }] }],
          },
        ];
      };
    await expect(f.observe()).rejects.toThrow();
    expect(
      await harness
        .database()
        .nativeRecoveryObservation.count({ where: { planId: f.planId } }),
    ).toBe(0);
    expect(
      await harness
        .database()
        .nativeRecoveryReceipt.count({ where: { planId: f.planId } }),
    ).toBe(0);
  },
);

test.each(["extra_archive", "sections_changed"] as const)(
  "all-video-section boundary protects %s",
  async (mode) => {
    const f = await fixture();
    const sections = f.observerContext.plex.sections;
    let reads = 0;
    f.observerContext.plex.sections = async (signal) => {
      const original = await sections(signal);
      reads++;
      return mode === "extra_archive" || reads > 1
        ? [
            ...original,
            { key: "unconfigured", title: "Other videos", type: "movie" },
          ]
        : original;
    };
    const page = f.observerContext.plex.libraryPage;
    f.observerContext.plex.libraryPage = async (input, signal) => {
      if (input.sectionId !== "unconfigured") return await page(input, signal);
      const archived = await harness.database().libraryAsset.findUniqueOrThrow({
        where: { id: z.uuid().parse(f.publications[0]?.entry.assetId) },
      });
      return {
        total: 1,
        items: [
          {
            ratingKey: "unconfigured-archive",
            type: "movie",
            title: "Synthetic archive",
            Media: [{ Part: [{ id: 1, file: archived.path }] }],
          },
        ],
      };
    };
    await expect(f.observe()).rejects.toThrow();
    expect(
      await harness
        .database()
        .nativeRecoveryObservation.count({ where: { planId: f.planId } }),
    ).toBe(0);
  },
);
