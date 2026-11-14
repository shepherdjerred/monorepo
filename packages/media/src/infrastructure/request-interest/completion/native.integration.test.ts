import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { completionFixture } from "./test-fixture.ts";
import { incompleteNativeRewatch } from "./playback-fixture.ts";
import { remapCompletionViewer } from "./remap-fixture.ts";
import { RequestInterestCommands } from "#infrastructure/request-interest/commands.ts";
import { getRequestInterestProgress } from "#infrastructure/request-interest/progress.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";

const h = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture(
  tv = false,
  originalLanguage = "en",
  initiallyComplete = true,
) {
  const f = await completionFixture(h, tv, originalLanguage, initiallyComplete);
  directories.push(f.files.directory);
  return f;
}

test("Continue rejects old/unobserved completions, retains watch truth, and finishes only a new counter cycle", async () => {
  const f = await fixture();
  const before = await f.read();
  expect(before.completionRequiredAfter).toBeNull();
  const renewed = await f.continued();
  expect(renewed.completionRequiredAfter).toEqual(renewed.interestRenewedAt);
  await f.observe(2); // First post-Continue increment could have occurred before Continue.
  await f.sweep();
  expect(await f.read()).toMatchObject({ interestState: "following" });
  await f.observe(2);
  await f.sweep();
  expect(await f.facts()).toMatchObject({
    watchedComplete: true,
    completionComplete: false,
    usableUnwatched: true,
  });
  expect(
    await getRequestInterestProgress(f.db, f.files.user, f.requestId),
  ).toMatchObject({
    status: "following",
    reason: "pending_native_completion",
    counts: { watched: 1, available: 1 },
  });
  await f.observe(3);
  expect(await f.facts()).toMatchObject({
    watchedComplete: true,
    completionComplete: true,
  });
  await f.sweep();
  expect(await f.read()).toMatchObject({
    interestState: "finished",
    interestReleaseReason: "watched",
  });
  expect(
    await f.db.watchState.findUniqueOrThrow({
      where: {
        userId_mediaId_edition: {
          userId: f.files.user.id,
          mediaId: f.rootId,
          edition: "default",
        },
      },
    }),
  ).toMatchObject({ watched: true, source: "plex_current" });
});

test("historical completion and actual 85-percent native progress do not finish an unfinished rewatch", async () => {
  const f = await fixture();
  await f.continued(1);
  await f.observe(1);
  const progress = await incompleteNativeRewatch(f);
  expect(await f.facts()).toMatchObject({
    completionComplete: false,
    progressAt: progress.meaningfulProgressAt?.getTime(),
  });
  await f.sweep();
  await f.sweep();
  expect(await f.read()).toMatchObject({
    interestState: "following",
    lastMeaningfulProgressAt: progress.meaningfulProgressAt,
  });
});

test.each(["decrease", "unknown", "rebind"] as const)(
  "%s clears a genuine window and requires a new native baseline",
  async (change) => {
    const f = await fixture();
    await f.continued();
    await f.observe(1);
    await f.observe(2);
    expect(await f.facts()).toMatchObject({ completionComplete: true });
    if (change === "unknown") await f.unknown();
    if (change === "rebind") await f.refreshBinding(true);
    await f.observe(change === "decrease" ? 1 : 3);
    expect(await f.facts()).toMatchObject({
      watchedComplete: true,
      completionComplete: false,
    });
    await f.sweep();
    expect(await f.read()).toMatchObject({ interestState: "following" });
  },
);

test("reverifying an unchanged native association preserves genuine completion", async () => {
  const f = await fixture();
  await f.continued();
  await f.observe(1);
  await f.observe(2);
  expect(await f.facts()).toMatchObject({ completionComplete: true });
  await f.refreshBinding();
  expect(await f.facts()).toMatchObject({ completionComplete: true });
  await f.sweep();
  expect(await f.read()).toMatchObject({
    interestState: "finished",
    interestReleaseReason: "watched",
  });
});

test("an ended followed series needs fresh completion for every requested leaf", async () => {
  const f = await fixture(true);
  const [first, second] = f.published.entry.mediaIds;
  if (first === undefined || second === undefined)
    throw new Error("Native shared TV fixture omitted its two leaves");
  await f.continued();
  await f.observe(1);
  await f.observe(2, [first]);
  expect(await f.facts()).toMatchObject({
    watchedComplete: true,
    completionComplete: false,
  });
  await f.sweep();
  expect(await f.read()).toMatchObject({ interestState: "following" });
  await f.observe(2, [second]);
  expect(await f.facts()).toMatchObject({ completionComplete: true });
  await f.sweep();
  expect(await f.read()).toMatchObject({
    interestState: "finished",
    interestReleaseReason: "series_finished",
  });
});

test("a renewed legacy foreign file keeps watch truth while required captions protect usability and progress", async () => {
  const f = await fixture(false, "ja");
  await f.continued();
  await f.observe(1);
  await f.observe(2);
  expect(await f.facts()).toMatchObject({
    watchedComplete: true,
    completionComplete: true,
    requestedCoverageComplete: false,
    usableUnwatched: false,
  });
  expect(
    await getRequestInterestProgress(f.db, f.files.user, f.requestId),
  ).toMatchObject({
    status: "following",
    reason: "required_english_captions_pending",
    counts: { watched: 1, available: 0, captionsPending: 1 },
  });
  await f.sweep();
  expect(await f.read()).toMatchObject({
    interestState: "following",
    interestNoticeEventId: null,
  });
});

test.each(["finished", "drop"] as const)(
  "a real V4 re-request after manual %s retains its unfinished ordinary cycle",
  async (action) => {
    const f = await fixture();
    const before = await f.read();
    await new RequestInterestCommands(f.db, { keepDays: 30 }).execute(
      f.files.user,
      crypto.randomUUID(),
      {
        schemaVersion: 1,
        requestId: before.id,
        expectedVersion: before.version,
        expectedInterestRevision: before.interestRevision,
        action,
      },
    );
    await f.requestAgain();
    const requested = await f.read();
    expect(requested.completionRequiredAfter).toBeNull();
    await f.observe(1);
    await f.sweep();
    await f.sweep();
    expect(await f.read()).toMatchObject({
      interestState: "finished",
      interestReleaseReason: "watched",
    });
  },
);

test("Keep watching an unfinished series credits its already watched prefix", async () => {
  const f = await fixture(true, "en", false);
  const leaves = f.published.entry.mediaIds;
  const last = leaves.at(-1);
  if (last === undefined)
    throw new Error("Partial native TV scope has no final episode");
  const renewed = await f.continued();
  expect(renewed.completionRequiredAfter).toBeNull();
  expect(
    await getRequestInterestProgress(f.db, f.files.user, f.requestId),
  ).toMatchObject({
    status: "following",
    counts: { watched: leaves.length - 1 },
  });
  await f.observe(1, [last]);
  await f.sweep();
  expect(await f.read()).toMatchObject({
    interestState: "finished",
    interestReleaseReason: "series_finished",
  });
});

test("Keep watching and Drop/re-request during a strict rewatch preserve completed-prefix credit", async () => {
  const f = await fixture(true);
  const [first, second] = f.published.entry.mediaIds;
  if (first === undefined || second === undefined)
    throw new Error("Native rewatch requires its whole two-leaf scope");
  const original = await f.continued();
  await f.observe(1);
  await f.observe(2, [first]);
  expect(await f.facts()).toMatchObject({ completionComplete: false });
  const renewed = await f.continued();
  expect(renewed.completionRequiredAfter).toEqual(
    original.completionRequiredAfter,
  );
  const request = await f.read();
  await new RequestInterestCommands(f.db, { keepDays: 30 }).execute(
    f.files.user,
    crypto.randomUUID(),
    {
      schemaVersion: 1,
      requestId: request.id,
      expectedVersion: request.version,
      expectedInterestRevision: request.interestRevision,
      action: "drop",
    },
  );
  await f.requestAgain();
  const requested = await f.read();
  expect(requested.completionRequiredAfter).toEqual(
    original.completionRequiredAfter,
  );
  await f.observe(2, [second]);
  expect(await f.facts()).toMatchObject({ completionComplete: true });
  await f.sweep();
  expect(await f.read()).toMatchObject({
    interestState: "finished",
    interestReleaseReason: "series_finished",
  });
});

test("native SQL rejects a forged completion window and watch invalidation removes its proof", async () => {
  const f = await fixture();
  await f.continued();
  await f.observe(1);
  const key = {
    userId: f.files.user.id,
    mediaId: f.rootId,
    edition: "default",
  };
  const baseline = await f.db.plexWatchProjection.findUniqueOrThrow({
    where: { userId_mediaId_edition: key },
  });
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const freshness = plexBindingFreshness({
    observed,
    expiresAtMs: observed.wall + 60_000,
    guards: [],
  });
  await expect(
    f.db.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness);
      return tx.plexWatchProjection.update({
        where: { userId_mediaId_edition: key },
        data: {
          completionPreviousObservedAt: baseline.observedAt,
          completionObservedAt: baseline.observedAt,
        },
      });
    }),
  ).rejects.toThrow("consecutive settled");
  await f.observe(2);
  expect(await f.facts()).toMatchObject({ completionComplete: true });
  // Actual WatchState invalidation is also used by remap and recovery producers.
  await f.db.watchState.delete({ where: { userId_mediaId_edition: key } });
  expect(
    await f.db.plexWatchProjection.findUnique({
      where: { userId_mediaId_edition: key },
    }),
  ).toBeNull();
  await f.observe(3);
  expect(await f.facts()).toMatchObject({ completionComplete: false });
});

test("a genuine profile remap invalidates old completion even when the physical association is unchanged", async () => {
  const f = await fixture();
  await f.continued();
  await f.observe(1);
  await f.observe(2);
  expect(await f.facts()).toMatchObject({ completionComplete: true });
  const binding = await f.db.plexBindingCurrent.findMany({
    where: { mediaId: f.rootId },
  });
  await remapCompletionViewer(f);
  expect(
    await f.db.watchState.count({ where: { userId: f.files.user.id } }),
  ).toBe(0);
  expect(
    await f.db.plexWatchProjection.count({
      where: { userId: f.files.user.id },
    }),
  ).toBe(0);
  expect(
    await f.db.plexBindingCurrent.findMany({ where: { mediaId: f.rootId } }),
  ).toEqual(binding);
  await f.observe(3);
  expect(await f.facts()).toMatchObject({
    watchedComplete: true,
    completionComplete: false,
  });
  await f.sweep();
  expect(await f.read()).toMatchObject({ interestState: "following" });
});

test("a usable old-watched rewatch starts its real inactivity notice clock instead of finishing", async () => {
  const f = await fixture();
  await f.continued(40);
  await f.observe(1);
  let firstUsable = true;
  const since = new Date(Date.now() - 40 * 86_400_000);
  const database = queryFixtureDatabase(f.db, {
    query: {
      mediaRequest: {
        async update({ args, query }) {
          // Simulate elapsed policy time only at the first usable-clock producer write.
          if (
            firstUsable &&
            args.where.id === f.requestId &&
            args.data.usableUnwatchedSince instanceof Date
          ) {
            args.data.usableUnwatchedSince = since;
            firstUsable = false;
          }
          return query(args);
        },
      },
    },
  });
  await f.sweep(database);
  await f.sweep(database);
  expect(await f.read()).toMatchObject({
    interestState: "following",
    interestNoticeEventId: expect.any(String),
  });
  expect(await f.facts()).toMatchObject({
    watchedComplete: true,
    completionComplete: false,
    usableUnwatched: true,
  });
});
