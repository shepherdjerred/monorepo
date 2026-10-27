import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createManagedMovieFixture } from "#testing/movie-workflow/managed-fixture.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { MovieAttemptOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import { reconcileMovieIntentV4 } from "#automation/movie-editions/reconcile.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { queueLibraryMovieDue } from "#automation/reconciliation/library-movies.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import {
  LibraryMovieManagementAuthoritySchema,
  MovieAcquisitionIdentityV3Schema,
} from "#shared/movie-editions/management/contracts.ts";

const h = automationTestHarness();
const directories: string[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
beforeAll(async () => {
  original = await movieVideoFixture();
  upgrade = await movieVideoFixture(3840, undefined, { bitrateKbps: 160_000 });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

function fixture() {
  return createManagedMovieFixture(
    h,
    "extended_cut",
    (directory) => directories.push(directory),
    { original, upgrade },
  );
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function reserve(f: Fixture) {
  const result = await f.movie.reconcileMovieIntentV4(
    f.input,
    testPlexBindingExecution(),
  );
  expect(result, JSON.stringify(result)).toMatchObject({ status: "acquire" });
  const input = MovieAttemptOperationV4Schema.parse({
    schemaVersion: 4,
    operationId: f.input.operationId,
    attemptId: result.attemptId,
    scope: f.scope,
  });
  const attempt = await h
    .database()
    .acquisitionAttempt.findUniqueOrThrow({ where: { id: input.attemptId } });
  return { input, attempt };
}

async function changePolicy(
  f: Fixture,
  change: "monitoring" | "generation" | "owner" | "profile",
) {
  const db = h.database();
  if (change === "owner") {
    await db.mediaUser.update({
      where: { id: f.network.actor.id },
      data: { role: "member" },
    });
  } else if (change === "profile") {
    const profile = await db.qualityProfile.findUniqueOrThrow({
      where: { id: f.profile.id },
    });
    const rules = QualityRulesSchema.parse(profile.rules);
    await db.qualityProfileVersion.create({
      data: { profileId: profile.id, version: profile.version + 1, rules },
    });
    await db.qualityProfile.update({
      where: { id: profile.id },
      data: { version: profile.version + 1, rules },
    });
  } else {
    await db.mediaIntent.update({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
      data:
        change === "monitoring"
          ? { monitoring: false }
          : { generation: { increment: 1 } },
    });
  }
}

test.each(["monitoring", "generation", "owner", "profile"] as const)(
  "changed %s cancels an unsubmitted managed acquisition without fabricating personal consent",
  async (change) => {
    const f = await fixture();
    const { input, attempt } = await reserve(f);
    const login = vi.spyOn(f.wire.qbittorrent, "login");
    const before = await h
      .database()
      .libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } });
    await changePolicy(f, change);
    expect(
      await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "obsolete", reason: "intent_changed" });
    expect(login).not.toHaveBeenCalled();
    expect(f.wire.additions()).toBe(0);
    expect(
      await h
        .database()
        .acquisitionReservation.count({ where: { attemptId: attempt.id } }),
    ).toBe(0);
    expect(
      await h
        .database()
        .acquisitionAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
    ).toMatchObject({
      state: "cancelled",
      torrentId: null,
      identityEvidence: attempt.identityEvidence,
      movieEditionAuthority: attempt.movieEditionAuthority,
    });
    expect(
      await h
        .database()
        .libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toEqual(before);
    expect(
      await h
        .database()
        .mediaRequest.count({ where: { mediaId: f.scope.mediaId } }),
    ).toBe(0);
  },
);

test("a management policy change during the last lookup prevents the actual add", async () => {
  const f = await fixture();
  const { input, attempt } = await reserve(f);
  f.wire.control.beforeInfo = () => changePolicy(f, "monitoring");
  expect(
    await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "obsolete", reason: "intent_changed" });
  expect(f.wire.additions()).toBe(0);
  expect(
    await h
      .database()
      .acquisitionReservation.count({ where: { attemptId: attempt.id } }),
  ).toBe(0);
});

test("an uncertain managed add retains its reservation until observation records the actual transfer and independent seeding", async () => {
  const f = await fixture();
  const { input, attempt } = await reserve(f);
  f.wire.control.loseAddReply = true;
  expect(
    await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "blocked", reason: "outcome-unknown" });
  await changePolicy(f, "monitoring");
  f.wire.control.visible = false;
  expect(
    await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "blocked", reason: "submission_outcome_unknown" });
  expect(
    await h
      .database()
      .acquisitionReservation.count({ where: { attemptId: attempt.id } }),
  ).toBe(1);
  f.wire.control.visible = true;
  expect(
    await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "submitted", reason: null });
  const recorded = await h
    .database()
    .acquisitionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  expect(recorded).toMatchObject({
    state: "cancelled",
    identityEvidence: attempt.identityEvidence,
    movieEditionAuthority: attempt.movieEditionAuthority,
  });
  if (recorded.torrentId === null)
    throw new Error("Actual prior add lost independent seeding responsibility");
  expect(
    await h
      .database()
      .torrent.findUniqueOrThrow({ where: { id: recorded.torrentId } }),
  ).toMatchObject({ owned: true });
  expect(
    await h.database().operation.count({
      where: { idempotencyKey: `seed:${recorded.torrentId}` },
    }),
  ).toBe(1);
  expect(
    await h
      .database()
      .acquisitionReservation.count({ where: { attemptId: attempt.id } }),
  ).toBe(0);
  expect(f.wire.additions()).toBe(1);
});

test("the original management invocation expires during provider discovery without a replacement grant", async () => {
  const f = await fixture();
  const execution = testPlexBindingExecution();
  let expired = false;
  f.wire.control.beforeProvider = () => {
    expired = true;
    return Promise.resolve();
  };
  const assertActive = () => {
    execution.assertActive();
    if (expired) throw new Error("Original management SDK invocation expired");
  };
  await expect(
    f.movie.reconcileMovieIntentV4(f.input, { ...execution, assertActive }),
  ).rejects.toThrow("Original management SDK invocation expired");
  expect(
    await h.database().acquisitionAttempt.count({
      where: { mediaIds: { has: f.scope.mediaId } },
    }),
  ).toBe(0);
  expect(f.wire.additions()).toBe(0);
});

test("management discovery uses the caller's remaining provenance allowance", async () => {
  const f = await fixture();
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  await expect(
    reconcileMovieIntentV4(
      { ...f.context, movieManagement: { execution, budget } },
      f.input,
    ),
  ).rejects.toThrow("100 total queried records");
  expect(
    await h.database().acquisitionAttempt.count({
      where: { mediaIds: { has: f.scope.mediaId } },
    }),
  ).toBe(0);
  expect(f.wire.additions()).toBe(0);
});

test("recurring management queues deduplicate their actual scoped operation and stop when monitoring is disabled", async () => {
  const f = await fixture();
  expect(await queueLibraryMovieDue(f.context, f.scope)).toBe(
    f.input.operationId,
  );
  await changePolicy(f, "monitoring");
  expect(await queueLibraryMovieDue(f.context, f.scope)).toBeNull();
  expect(
    await h.database().operation.count({
      where: {
        targetId: f.scope.mediaId,
        kind: "reconcile_movie_edition_v4",
      },
    }),
  ).toBe(1);
  expect(
    await h
      .database()
      .mediaRequest.count({ where: { mediaId: f.scope.mediaId } }),
  ).toBe(0);
});

test("a prepared managed publication retains its reservation after monitoring stops", async () => {
  const f = await fixture();
  const { input, attempt } = await reserve(f);
  expect(
    await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "submitted", reason: null });
  expect(
    await f.movie.observeMovieAcquisitionV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "ready", reason: null });
  expect(
    await f.fileMovie.inspectAndStageMovieV4(input, testPublicationExecution()),
  ).toEqual({ status: "staged" });
  const staged = await h
    .database()
    .acquisitionAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  await changePolicy(f, "monitoring");
  expect(
    await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
  ).toEqual({
    status: "blocked",
    reason: "movie_publication_reconciliation_required",
  });
  expect(
    await h
      .database()
      .acquisitionReservation.count({ where: { attemptId: attempt.id } }),
  ).toBe(1);
  expect(
    await h
      .database()
      .acquisitionAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
  ).toMatchObject({
    filePlan: staged.filePlan,
    identityEvidence: attempt.identityEvidence,
    movieEditionAuthority: attempt.movieEditionAuthority,
  });
  expect(f.wire.additions()).toBe(1);
});

test("SQL rejects forged library approval and preserves the actual immutable acquisition birth", async () => {
  const f = await fixture();
  const { attempt } = await reserve(f);
  const db = h.database();
  const birth = LibraryMovieManagementAuthoritySchema.parse(
    attempt.movieEditionAuthority,
  );
  const identity = MovieAcquisitionIdentityV3Schema.parse(
    attempt.identityEvidence,
  );
  const invalid = { ...birth, planHash: "f".repeat(64) };
  const patch = JSON.stringify({
    id: crypto.randomUUID(),
    movieEditionAuthority: invalid,
    identityEvidence: { ...identity, management: invalid },
  });
  await expect(
    db.$executeRaw`INSERT INTO "AcquisitionAttempt" SELECT (jsonb_populate_record(NULL::"AcquisitionAttempt", to_jsonb(a) || ${patch}::jsonb)).* FROM "AcquisitionAttempt" a WHERE a.id=${attempt.id}`,
  ).rejects.toThrow("exact current owner-approved library policy");
  await expect(
    db.$executeRaw`UPDATE "AcquisitionAttempt" SET "movieEditionAuthority"=${JSON.stringify(invalid)}::jsonb WHERE id=${attempt.id}`,
  ).rejects.toThrow("Managed acquisition birth is immutable");
  await expect(
    db.$executeRaw`UPDATE "AcquisitionAttempt" SET "sponsorRequestId"=${crypto.randomUUID()} WHERE id=${attempt.id}`,
  ).rejects.toThrow("Managed acquisition birth is immutable");
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    }),
  ).toEqual(attempt);
  expect(f.wire.additions()).toBe(0);
});
