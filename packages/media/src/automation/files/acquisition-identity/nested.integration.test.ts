import { expect, test } from "vitest";
import { readyNestedSeriesMember } from "#testing/series-workflow/nested-ready.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { PrismaNumberingAdministration } from "#infrastructure/numbering-admin.ts";

test("actual household discovery imports nested shorthand bytes, commits TV evidence and completes the original serving path", async () => {
  const { fixture, input, mediaId } =
    await readyNestedSeriesMember("Season 02/03.mkv");
  try {
    const before = await fixture.evidence();
    expect(
      await fixture.fileAcquisition.inspectAndStageMedia(
        input,
        testPublicationExecution(),
      ),
    ).toEqual({ status: "staged" });
    expect(
      await fixture.fileAcquisition.promoteMediaFiles(
        input,
        testPublicationExecution(),
      ),
    ).toEqual({ status: "published" });
    const { plexBinding } = await fixture.loadPublication();
    expect(
      await plexBinding.publishMediaToPlex(input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await plexBinding.finalizeMediaAcquisition(
      input,
      testPlexBindingExecution(),
    );
    const after = await fixture.evidence();
    expect(after.personalRequests).toBe(0);
    expect(after.adds).toBe(1);
    expect(after.attempts).toHaveLength(1);
    expect(after.attempts[0]).toMatchObject({
      state: "completed",
      reservations: [],
      torrent: { owned: true },
    });
    const plan = FilePlanSchema.parse(after.attempts[0]?.filePlan);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      mediaIds: [mediaId],
      libraryKind: "tv",
      identityEvidence: {
        schemaVersion: 2,
        kind: "tv_season_directory",
        sourceFile: { relativePath: "Season 02/03.mkv" },
        directory: { season: 2, episode: 3 },
      },
    });
    expect(
      after.assets.find((asset) => asset.id === fixture.originalAssetId),
    ).toEqual(
      before.assets.find((asset) => asset.id === fixture.originalAssetId),
    );
    expect(
      after.physical.every((file) => file.checksum === file.expectedChecksum),
    ).toBe(true);
  } finally {
    await fixture.close();
  }
}, 60_000);

test.each([
  ["Season 01/Show.S02E03.mkv", "coordinate_conflict"],
  ["Season 02/04.mkv", "coordinate_unmapped"],
  ["Season 00/03.mkv", "coordinate_unknown"],
  ["S02/Season 02/03.mkv", "coordinate_conflict"],
])(
  "actual reserved member %s protects before staging with %s",
  async (name, reason) => {
    const { fixture, input, mediaId } = await readyNestedSeriesMember(name);
    try {
      expect(
        await fixture.fileAcquisition.inspectAndStageMedia(
          input,
          testPublicationExecution(),
        ),
      ).toEqual({ status: "blocked", reason });
      const evidence = await fixture.evidence();
      expect(evidence.attempts[0]?.filePlan).toBeNull();
      expect(
        evidence.assets.filter((asset) =>
          asset.coverage.some((row) => row.mediaId === mediaId),
        ),
      ).toEqual([]);
    } finally {
      await fixture.close();
    }
  },
  60_000,
);

test("an actual owner numbering change during hashing invalidates the nested member before physical staging", async () => {
  const { fixture, input, mediaId } =
    await readyNestedSeriesMember("Season02/E03.mkv");
  try {
    let changed = false;
    fixture.testing.files.checkpoint = async (phase) => {
      if (phase !== "hashing" || changed) return;
      changed = true;
      const episode = await fixture.testing.db.mediaItem.findUniqueOrThrow({
        where: { id: mediaId },
      });
      await new PrismaNumberingAdministration(fixture.testing.db).save(
        fixture.testing.owner,
        crypto.randomUUID(),
        mediaId,
        {
          expectedVersion: episode.version,
          absoluteNumber: 203,
          evidence:
            "Owner verified the new episode mapping during actual member inspection",
        },
      );
    };
    expect(
      await fixture.fileAcquisition.inspectAndStageMedia(
        input,
        testPublicationExecution(),
      ),
    ).toEqual({ status: "blocked", reason: "intent_obsolete" });
    expect(changed).toBe(true);
    const evidence = await fixture.evidence();
    expect(evidence.attempts[0]?.filePlan).toBeNull();
  } finally {
    await fixture.close();
  }
}, 60_000);

test("nested publication retains the caller's exhausted allowance after real staging", async () => {
  const { fixture, input, mediaId } =
    await readyNestedSeriesMember("Season02/E03.mkv");
  try {
    expect(
      await fixture.fileAcquisition.inspectAndStageMedia(
        input,
        testPublicationExecution(),
      ),
    ).toEqual({ status: "staged" });
    const budget = new PublicationAuthorityReadBudget();
    budget.consume(99);
    const physical = createMediaFileActivities({
      ...fixture.testing.files,
      libraryManagement: {
        freshness: fixture.testing.context.plexBindingExecution(),
        access: await fixture.testing.context.plexAccess("show"),
        budget,
      },
    });
    expect(await physical.promoteMediaFiles(input)).toEqual({
      status: "blocked",
      reason: "archive_transition_reconciliation_required",
    });
    expect(() => budget.consume(1)).toThrow("100 total queried records");
    const evidence = await fixture.evidence();
    expect(
      evidence.assets.filter((asset) =>
        asset.coverage.some((row) => row.mediaId === mediaId),
      ),
    ).toEqual([]);
  } finally {
    await fixture.close();
  }
}, 60_000);

test("expiry of the original execution during hashing cannot be renewed for nested staging", async () => {
  const { fixture, input } = await readyNestedSeriesMember("Season02/E03.mkv");
  try {
    let expired = false;
    const execution = testPublicationExecution();
    fixture.testing.files.checkpoint = (phase) => {
      if (phase === "hashing") expired = true;
      return Promise.resolve();
    };
    await expect(
      fixture.fileAcquisition.inspectAndStageMedia(input, {
        ...execution,
        assertActive: () => {
          execution.assertActive();
          if (expired) throw new Error("Original nested execution expired");
        },
      }),
    ).rejects.toThrow("Original nested execution expired");
    expect(expired).toBe(true);
    const evidence = await fixture.evidence();
    expect(evidence.attempts[0]?.filePlan).toBeNull();
  } finally {
    await fixture.close();
  }
}, 60_000);
