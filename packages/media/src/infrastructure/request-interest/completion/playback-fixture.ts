/** Extended-only native collector: stopped imported history cannot become a completion. */
import { expect } from "vitest";
import type { completionFixture } from "./test-fixture.ts";
import { PrismaPlaybackHistory } from "#infrastructure/playback/service.ts";
import { PrismaPlaybackCollector } from "#infrastructure/playback/collector.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { PlexPlaybackSession } from "#integrations/plex-playback.ts";

export async function incompleteNativeRewatch(
  f: Awaited<ReturnType<typeof completionFixture>>,
) {
  const owner = await f.db.mediaUser.findFirstOrThrow({
    where: { role: "owner", restricted: false },
  });
  const mapping = await f.db.plexIdentityMapping.findUniqueOrThrow({
    where: { userId: f.files.user.id },
  });
  if (mapping.serverAccountId === null)
    throw new Error("Native viewer mapping missing");
  const claim = await f.db.plexItemClaim.findFirstOrThrow({
    where: {
      mediaId: f.rootId,
      edition: "default",
      serverMachineId: mapping.serverMachineId,
    },
  });
  const clock = { now: new Date(Date.now() - 180_000) };
  const through = clock.now.toISOString();
  const sourceInstanceId = "synthetic-completion-history";
  const rows = [
    {
      id: "1",
      user_id: mapping.serverAccountId,
      rating_key: claim.ratingKey,
      started: Math.floor(clock.now.getTime() / 1000) - 300,
      stopped: Math.floor(clock.now.getTime() / 1000) - 1,
      duration: 250,
      percent_complete: 100,
      full_title: "Synthetic historical completed viewing",
      grandparent_title: null,
      media_type: "movie",
      platform: "tvOS",
      player: "Synthetic TV",
      transcode_decision: "direct_play" as const,
    },
  ];
  const history = new PrismaPlaybackHistory(
    f.db,
    mapping.serverMachineId,
    () => clock.now,
    () =>
      Promise.resolve({
        capturedAt: new Date(through),
        expiresAt: new Date(clock.now.getTime() + 60_000),
        inventoryDigest: "synthetic-completion-history",
      }),
  );
  await history.importHistory(owner, {
    sourceInstanceId,
    serverMachineId: mapping.serverMachineId,
    through,
    rows,
    userBindings: [
      {
        sourceUserId: mapping.serverAccountId,
        userId: f.files.user.id,
        plexAccountId: f.files.user.plexAccountId,
      },
    ],
  });
  const checkpoint = await f.db.playbackCollector.findUniqueOrThrow({
    where: { serverMachineId: mapping.serverMachineId },
  });
  await history.sealHandoff(owner, {
    sourceInstanceId,
    through,
    expectedVersion: checkpoint.version,
    expectedSessions: 1,
    snapshotDigest: snapshotHash(
      rows.map((row) => ({ id: row.id, sha256: snapshotHash(row) })),
    ),
    quiescenceCapturedAt: through,
    inventoryDigest: "synthetic-completion-history",
  });
  expect(await f.facts()).toMatchObject({
    progressAt: null,
    completionComplete: false,
  });
  const session: PlexPlaybackSession = {
    sessionId: crypto.randomUUID(),
    serverAccountId: mapping.serverAccountId,
    ratingKey: claim.ratingKey,
    title: "Synthetic unfinished rewatch",
    seriesTitle: null,
    mediaType: "movie",
    platform: "tvOS",
    playerId: crypto.randomUUID(),
    state: "playing",
    durationMs: 140_000,
    progressMs: 0,
    decision: "direct_play",
  };
  let sessions = [session];
  const collector = new PrismaPlaybackCollector(
    f.db,
    { sessions: () => Promise.resolve(sessions) },
    mapping.serverMachineId,
    () => clock.now,
  );
  clock.now = new Date(clock.now.getTime() + 1);
  await collector.reconcile();
  for (let sample = 0; sample < 2; sample++) {
    clock.now = new Date(clock.now.getTime() + 60_000);
    session.progressMs += 60_000;
    await collector.reconcile();
  }
  sessions = [];
  clock.now = new Date(clock.now.getTime() + 1);
  await collector.reconcile();
  const recorded = await f.db.playbackSessionIdentity.findUniqueOrThrow({
    where: {
      source_sourceInstanceId_sourceSessionId: {
        source: "plex",
        sourceInstanceId: mapping.serverMachineId,
        sourceSessionId: session.sessionId,
      },
    },
    include: { session: true },
  });
  expect(recorded.session).toMatchObject({
    state: "stopped",
    watchedMs: 120_000,
    reportingCompleted: true,
  });
  expect(recorded.session.meaningfulProgressAt).toBeInstanceOf(Date);
  return recorded.session;
}
