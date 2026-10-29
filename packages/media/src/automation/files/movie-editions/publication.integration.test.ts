import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { automationTestHarness } from "#testing/automation.ts";
import { movieFilesV4Fixture } from "#testing/movie-files-v4.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { MovieFilePlanV2Schema } from "#shared/movie-editions/file-plan-v2.ts";
import {
  MoviePublicationIntentV2Schema,
  MoviePublicationOutcomeV2Schema,
} from "#shared/movie-editions/publication-v2.ts";
import { PublicationIntentSchema } from "#shared/publication-proof/intent.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { findMoviePublicationReferenceV2 } from "#infrastructure/movie-editions/publication/store.ts";
import { inspectAndStageMovieV4 } from "./inspection.ts";
import { promoteMovieV4 } from "./publication.ts";

const h = automationTestHarness();
const directories: string[] = [];
let clip: Uint8Array;
beforeAll(async () => {
  clip = await movieVideoFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture(edition: MovieEditionKey = "extended_cut") {
  const f = await movieFilesV4Fixture(
    h.database(),
    h.context(),
    await h.fixture(),
    { edition, bytes: clip },
  );
  directories.push(f.files.directory);
  await inspectAndStageMovieV4(f.files.context, f.input);
  const attempt = await h
    .database()
    .acquisitionAttempt.findUniqueOrThrow({ where: { id: f.attempt.id } });
  return { ...f, plan: MovieFilePlanV2Schema.parse(attempt.filePlan) };
}

test.each(MovieEditionKeySchema.options)(
  "actual %s publication retains scoped ownership, bytes, captions and immutable retry",
  async (edition) => {
    const f = await fixture(edition);
    const entry = f.plan.entries[0];
    await promoteMovieV4(f.files.context, f.input);
    const db = h.database();
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: entry.assetId },
      include: { coverage: true, subtitles: true },
    });
    expect(asset).toMatchObject({
      edition,
      editionRootId: f.media.id,
      owned: true,
      ownershipEpoch: 0,
      state: "published",
      checksum: entry.checksum,
      version: 0,
      plexPublishedAt: null,
      coverage: [{ mediaId: f.media.id, edition, current: true }],
    });
    expect(
      await readFile(path.join(f.files.roots.library, entry.libraryPath)),
    ).toEqual(Buffer.from(clip));
    expect(await readFile(f.source)).toEqual(Buffer.from(clip));
    expect(asset.subtitles.map((row) => row.language).sort()).toEqual([
      "en",
      "zh-Hans",
    ]);
    for (const subtitle of asset.subtitles) {
      const source = entry.embeddedSubtitles.find(
        (row) => row.id === subtitle.id,
      );
      expect(source).toBeDefined();
      if (source === undefined)
        throw new Error("Missing actual extracted subtitle");
      expect(subtitle).toMatchObject({
        state: "validated",
        ownershipEpoch: 0,
        videoChecksum: entry.checksum,
        matchingEvidence: {
          schemaVersion: 4,
          movieScope: f.input.scope,
          exactMediaMatch: true,
        },
      });
      expect(Buffer.from(subtitle.content ?? [])).toEqual(
        await readFile(path.join(f.files.roots.control, source.relativePath)),
      );
    }
    expect(
      await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.media.id, edition } },
      }),
    ).toMatchObject({ availability: "importing" });
    expect(
      await db.mediaItem.findUniqueOrThrow({ where: { id: f.media.id } }),
    ).toMatchObject({
      availability: edition === "default" ? "importing" : f.media.availability,
    });
    const record = await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: f.attempt.id },
    });
    const intent = MoviePublicationIntentV2Schema.parse(record.intent);
    const outcome = MoviePublicationOutcomeV2Schema.parse(record.outcome);
    expect(PublicationIntentSchema.safeParse(record.intent).success).toBe(
      false,
    );
    expect(intent).toMatchObject({
      schemaVersion: 2,
      scope: f.input.scope,
      entries: [{ entry, predecessor: null, originalGrant: null }],
    });
    expect(outcome).toMatchObject({
      schemaVersion: 2,
      kind: "published",
      scope: f.input.scope,
      intentHash: record.intentHash,
      entries: [
        {
          successor: {
            id: asset.id,
            scope: f.input.scope,
            edition,
            checksum: entry.checksum,
          },
        },
      ],
    });
    expect(record.intentHash).toBe(snapshotHash(nativeJson(record.intent)));
    expect(record.outcomeHash).toBe(snapshotHash(nativeJson(record.outcome)));
    expect(outcome.effects.length).toBeGreaterThan(0);
    const effects = await db.applicationEvent.count({
      where: { mediaId: f.media.id, kind: "files_published" },
    });
    await promoteMovieV4(f.files.context, f.input);
    expect(
      await db.mediaPublicationTransition.findUniqueOrThrow({
        where: { attemptId: f.attempt.id },
      }),
    ).toEqual(record);
    expect(
      await db.applicationEvent.count({
        where: { mediaId: f.media.id, kind: "files_published" },
      }),
    ).toBe(effects);
    await expect(
      db.mediaPublicationTransition.update({
        where: { id: record.id },
        data: {
          intent: {
            ...intent,
            scope: {
              ...intent.scope,
              edition: edition === "default" ? "extended_cut" : "default",
            },
          },
        },
      }),
    ).rejects.toThrow();
  },
);

test.each(["publication-intent-committed", "publication-before-commit"])(
  "retry after crash at %s uses the original intent and actual WAL prefix",
  async (crash) => {
    const f = await fixture();
    f.files.context.checkpoint = (phase) =>
      phase === crash
        ? Promise.reject(new Error("crash fixture"))
        : Promise.resolve();
    await expect(promoteMovieV4(f.files.context, f.input)).rejects.toThrow(
      "crash fixture",
    );
    const before = await h
      .database()
      .mediaPublicationTransition.findUniqueOrThrow({
        where: { attemptId: f.attempt.id },
      });
    expect(before.outcome).toBeNull();
    expect(
      await h
        .database()
        .libraryAsset.findUnique({ where: { id: f.plan.entries[0].assetId } }),
    ).toBeNull();
    f.files.context.checkpoint = () => Promise.resolve();
    await promoteMovieV4(f.files.context, f.input);
    const after = await h
      .database()
      .mediaPublicationTransition.findUniqueOrThrow({
        where: { attemptId: f.attempt.id },
      });
    expect(after.intent).toEqual(before.intent);
    expect(after.intentHash).toBe(before.intentHash);
    expect(MoviePublicationOutcomeV2Schema.parse(after.outcome)).toMatchObject({
      kind: "published",
      scope: f.input.scope,
    });
    expect(
      await readFile(
        path.join(f.files.roots.library, f.plan.entries[0].libraryPath),
      ),
    ).toEqual(Buffer.from(clip));
  },
);

test("another edition cannot reuse the staged file plan or completed publication", async () => {
  const f = await fixture();
  const wrong = {
    ...f.input,
    scope: { ...f.input.scope, edition: "theatrical_cut" as const },
  };
  await expect(promoteMovieV4(f.files.context, wrong)).rejects.toMatchObject({
    reason: "movie_publication_scope_changed",
  });
  expect(
    await h.database().mediaPublicationTransition.findUnique({
      where: { attemptId: f.attempt.id },
    }),
  ).toBeNull();
  await promoteMovieV4(f.files.context, f.input);
  await expect(promoteMovieV4(f.files.context, wrong)).rejects.toMatchObject({
    reason: "movie_publication_scope_changed",
  });
});

test("a subsequent publication resolves the actual scoped physical parent and retains the caller's shared read budget", async () => {
  const f = await fixture();
  await promoteMovieV4(f.files.context, f.input);
  const db = h.database();
  const budget = new PublicationAuthorityReadBudget();
  const asset = await snapshotMoviePublicationAssetV2(
    db,
    f.input.scope,
    f.plan.entries[0].assetId,
    budget,
  );
  const reference = await findMoviePublicationReferenceV2(
    db,
    { scope: f.input.scope, asset },
    budget,
  );
  expect(reference).toMatchObject({
    kind: "movie_publication_transition_v2",
    scope: f.input.scope,
    assetId: asset.id,
    assetVersion: asset.version,
    bindingHash: snapshotHash(nativeJson(asset)),
  });
  expect(budget.take).toBeLessThan(101);
  await expect(
    snapshotMoviePublicationAssetV2(
      db,
      { ...f.input.scope, edition: "theatrical_cut" },
      asset.id,
      budget,
    ),
  ).rejects.toThrow("another physical scope");
  const exhausted = new PublicationAuthorityReadBudget();
  exhausted.consume(100);
  await expect(
    findMoviePublicationReferenceV2(
      db,
      { scope: f.input.scope, asset },
      exhausted,
    ),
  ).rejects.toThrow("100 total queried records");
});

async function cancel(f: Awaited<ReturnType<typeof fixture>>) {
  const user = await h
    .database()
    .mediaUser.findUniqueOrThrow({ where: { id: f.result.subjectUserId } });
  await f.commands.cancelMovieEditionRequest(
    { ...user, role: "member" },
    crypto.randomUUID(),
    {
      schemaVersion: 3,
      action: "cancel_request",
      subjectUserId: user.id,
      scope: f.input.scope,
      requestId: f.result.requestId,
      expected: {
        targetVersion: f.result.applied.targetVersion,
        requestVersion: f.result.applied.requestVersion,
        choiceRevision: f.result.applied.choiceRevision,
      },
    },
  );
}

test.each(["publication-intent-committed", "publication-before-commit"])(
  "cancellation after crash at %s compensates exact prior effects without importing or deleting the source",
  async (crash) => {
    const f = await fixture();
    f.files.context.checkpoint = (phase) =>
      phase === crash
        ? Promise.reject(new Error("crash fixture"))
        : Promise.resolve();
    await expect(promoteMovieV4(f.files.context, f.input)).rejects.toThrow(
      "crash fixture",
    );
    const before = await h
      .database()
      .mediaPublicationTransition.findUniqueOrThrow({
        where: { attemptId: f.attempt.id },
      });
    await cancel(f);
    f.files.context.checkpoint = () => Promise.resolve();
    await expect(
      promoteMovieV4(f.files.context, f.input),
    ).rejects.toMatchObject({ reason: "movie_acquisition_obsolete" });
    const settled = await h
      .database()
      .mediaPublicationTransition.findUniqueOrThrow({
        where: { attemptId: f.attempt.id },
      });
    expect(settled.intentHash).toBe(before.intentHash);
    expect(settled.intent).toEqual(before.intent);
    expect(
      MoviePublicationOutcomeV2Schema.parse(settled.outcome),
    ).toMatchObject({
      kind: "compensated",
      scope: f.input.scope,
      entries: [{ successor: null, predecessor: null }],
    });
    const entry = f.plan.entries[0];
    expect(
      await Bun.file(
        path.join(f.files.roots.library, entry.libraryPath),
      ).exists(),
    ).toBe(false);
    if (crash === "publication-before-commit")
      expect(
        await readFile(
          path.join(f.files.roots.control, "quarantine", entry.assetId),
        ),
      ).toEqual(Buffer.from(clip));
    expect(await readFile(f.source)).toEqual(Buffer.from(clip));
    expect(
      await h
        .database()
        .libraryAsset.findUnique({ where: { id: entry.assetId } }),
    ).toBeNull();
    expect(
      await h
        .database()
        .acquisitionAttempt.findUniqueOrThrow({ where: { id: f.attempt.id } }),
    ).toMatchObject({
      state: "obsolete",
      movieEditionAuthority: f.attempt.movieEditionAuthority,
    });
    expect(
      await h
        .database()
        .acquisitionReservation.count({ where: { attemptId: f.attempt.id } }),
    ).toBe(0);
    await expect(
      promoteMovieV4(f.files.context, f.input),
    ).rejects.toMatchObject({ reason: "movie_publication_compensated" });
    expect(
      await h.database().mediaPublicationTransition.findUniqueOrThrow({
        where: { attemptId: f.attempt.id },
      }),
    ).toEqual(settled);
  },
);

test("expiry after intent capture retains the original invocation and prevents filesystem publication", async () => {
  const f = await fixture();
  const execution = testPublicationExecution();
  let captures = 0;
  f.files.context.publicationExecution = () => {
    captures++;
    return execution;
  };
  f.files.context.checkpoint = (phase) => {
    if (phase === "publication-intent-committed")
      vi.spyOn(Date, "now").mockReturnValue(execution.observed.wall + 60_001);
    return Promise.resolve();
  };
  await expect(promoteMovieV4(f.files.context, f.input)).rejects.toThrow();
  expect(captures).toBe(1);
  expect(
    await Bun.file(
      path.join(f.files.roots.library, f.plan.entries[0].libraryPath),
    ).exists(),
  ).toBe(false);
  expect(
    await h
      .database()
      .libraryAsset.findUnique({ where: { id: f.plan.entries[0].assetId } }),
  ).toBeNull();
  expect(
    await h.database().mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: f.attempt.id },
    }),
  ).toMatchObject({ outcome: null, outcomeHash: null });
});
