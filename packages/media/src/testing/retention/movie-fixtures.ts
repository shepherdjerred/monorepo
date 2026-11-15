import { afterEach, beforeAll, expect } from "vitest";
import { rm } from "node:fs/promises";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { elapsedQuarantineClient } from "#automation/files/plex-binding/elapsed-quarantine.test-support.ts";
import type { FileContext } from "#automation/files/types.ts";
import type { prepareBoundRetention } from "#automation/retention/lifecycle.test-fixture.ts";
import type { automaticSubtitleHarness } from "#automation/subtitle-maintenance/test-fixture.ts";
import { createSubtitleReplacementActivities } from "#automation/subtitle-replacement/activities.ts";
import type { createMovieRetentionFixture } from "#testing/movie-workflow/retention-fixture.ts";

/** Exact edition target and personal consent used before lifecycle commands. */
export async function movieFixtureConsent(
  f: Pick<
    Awaited<ReturnType<typeof createMovieRetentionFixture>>,
    "db" | "scope"
  >,
  userId: string,
) {
  const scope = { mediaId: f.scope.mediaId, edition: f.scope.edition };
  const [target, request] = await Promise.all([
    f.db.mediaIntent.findUniqueOrThrow({ where: { mediaId_edition: scope } }),
    f.db.mediaRequest.findUniqueOrThrow({
      where: { userId_mediaId_edition: { userId, ...scope } },
    }),
  ]);
  return { target, request };
}

/** One actual video per suite; each consumer retains its own disposable resources. */
export function retentionMovieFixtures() {
  let video: Uint8Array | undefined;
  const closers: (() => Promise<void>)[] = [],
    directories: string[] = [];
  beforeAll(async () => {
    video = await movieVideoFixture();
  });
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
    for (const directory of directories.splice(0))
      await rm(directory, { recursive: true, force: true });
  });
  return {
    closers,
    directories,
    bytes() {
      if (video === undefined)
        throw new Error("Retention movie fixture video is not initialized");
      return video;
    },
  };
}

/** Only the original quarantine birth sees elapsed policy time, with real Files authority intact. */
export async function quarantineFixtureWithElapsedGrace(
  files: { context: FileContext; media: { id: string } },
  bound: Pick<
    Awaited<ReturnType<typeof prepareBoundRetention>>,
    "retention" | "quarantine"
  >,
) {
  const db = files.context.db;
  const timing = await elapsedQuarantineClient(db, {
    ...bound.retention.input,
    mediaIds: [files.media.id],
  });
  files.context.db = timing.db;
  try {
    expect(await bound.quarantine()).toEqual({ status: "quarantined" });
  } finally {
    files.context.db = db;
  }
  return { birth: await timing.assertCommitted(), timing };
}

/** Same real automatic ancestry and native preparation; callers retain their own result assertions. */
export async function prepareAutomaticFixtureReplacement(
  f: Awaited<ReturnType<ReturnType<typeof automaticSubtitleHarness>["setup"]>>,
) {
  const input = { job: f.job, candidateSubtitleId: f.candidate.id };
  const prepared = await f.automatic.begin(input);
  if (prepared === null) throw new Error("Automatic preparation missing");
  const files = createSubtitleReplacementActivities(f.context);
  const preparation = await files.prepareSubtitleReplacement({
    replacementId: prepared.replacementId,
    operationId: prepared.preparationOperationId,
  });
  return {
    input,
    prepared,
    files,
    preparation,
    approve: () =>
      f.automatic.approve({ ...input, replacementId: prepared.replacementId }),
  };
}

/** Preserve real private warning acceptance and the original seven-day eligibility proof. */
export async function acceptedFixtureMovieWarning(
  f: Pick<
    Awaited<ReturnType<typeof createMovieRetentionFixture>>,
    "warning" | "deliverWarning" | "evaluate" | "context"
  >,
  errorMessage: string,
) {
  expect(await f.warning()).toMatchObject({ status: "warning" });
  await f.deliverWarning();
  const due = await f.evaluate();
  if (
    due.status !== "quarantine" ||
    due.decisionId === null ||
    f.context.now === undefined
  )
    throw new Error(errorMessage);
  return { due: { ...due, decisionId: due.decisionId }, now: f.context.now };
}
