import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { PrismaPlaybackHistory } from "./service.ts";
import { PrismaPlaybackCollector } from "./collector.ts";
import { ImportPlaybackHistorySchema } from "#shared/household/playback.ts";
import type { PlexPlaybackSession } from "#integrations/plex-playback.ts";
import { snapshotHash } from "#migration/profile-import.ts";

let postgres: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  postgres = await startMediaTestPostgres();
});
afterAll(async () => {
  await postgres.close();
});

async function fixture() {
  const db = postgres.database;
  const server = crypto.randomUUID();
  const owner = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Owner",
      role: "owner",
    },
  });
  const member = await db.mediaUser.create({
    data: { plexAccountId: crypto.randomUUID(), displayName: "Member" },
  });
  const time = { now: new Date("2026-11-14T12:00:00Z") };
  const quiescedAt = new Date(time.now.getTime() - 10_000);
  const service = new PrismaPlaybackHistory(
    db,
    server,
    () => time.now,
    () =>
      Promise.resolve({
        capturedAt: quiescedAt,
        expiresAt: new Date(time.now.getTime() + 60_000),
        inventoryDigest: "actual-fixture-inventory",
      }),
  );
  const end = Math.floor(time.now.getTime() / 1000) - 100;
  const input = ImportPlaybackHistorySchema.parse({
    sourceInstanceId: server,
    serverMachineId: server,
    through: new Date(time.now.getTime() - 5000).toISOString(),
    rows: [
      {
        id: "1",
        user_id: "123",
        rating_key: "42",
        started: end - 300,
        stopped: end,
        duration: 250,
        percent_complete: 86,
        full_title: "Historical title",
        grandparent_title: null,
        media_type: "movie",
        platform: "tvOS",
        player: "Apple TV",
        transcode_decision: "direct_play",
      },
      {
        id: "2",
        user_id: "unmapped",
        rating_key: "43",
        started: end - 300,
        stopped: end,
        duration: 200,
        percent_complete: 40,
        full_title: "Unmapped title",
        grandparent_title: null,
        media_type: "movie",
        platform: "Web",
        player: "Browser",
        transcode_decision: "transcode",
      },
    ],
    userBindings: [
      {
        sourceUserId: "123",
        userId: member.id,
        plexAccountId: member.plexAccountId,
      },
    ],
  });
  const seal = async () => {
    const checkpoint = await db.playbackCollector.findUniqueOrThrow({
      where: { serverMachineId: server },
    });
    return service.sealHandoff(owner, {
      sourceInstanceId: server,
      through: input.through,
      expectedVersion: checkpoint.version,
      expectedSessions: input.rows.length,
      snapshotDigest: snapshotHash(
        input.rows
          .map((row) => ({ id: row.id, sha256: snapshotHash(row) }))
          .sort((left, right) =>
            left.id.localeCompare(right.id, "en", { numeric: false }),
          ),
      ),
      quiescenceCapturedAt: quiescedAt.toISOString(),
      inventoryDigest: "actual-fixture-inventory",
    });
  };
  return { db, server, owner, member, time, service, input, seal };
}

describe("historical playback isolation and handoff", () => {
  it("imports once, preserves unmapped sessions privately, and never changes current watched state", async () => {
    const f = await fixture();
    expect(await f.service.importHistory(f.owner, f.input)).toEqual({
      imported: 2,
      unchanged: 0,
    });
    expect(await f.service.importHistory(f.owner, f.input)).toEqual({
      imported: 0,
      unchanged: 2,
    });
    const ownerHistory = await f.service.history(f.owner, { limit: 50 });
    const ownHistory = await f.service.history(f.member, { limit: 50 });
    expect(ownerHistory.items).toHaveLength(2);
    expect(ownHistory.items.map((row) => row.title)).toEqual([
      "Historical title",
    ]);
    const statistics = await f.service.statistics(f.member, { limit: 50 });
    expect(statistics.plays).toBe(1);
    expect(await f.db.watchState.count()).toBe(0);
    expect(
      await f.db.playbackSession.count({
        where: {
          serverMachineId: f.server,
          meaningfulProgressAt: { not: null },
        },
      }),
    ).toBe(0);
    await f.db.mediaUser.update({
      where: { id: f.member.id },
      data: { restricted: true },
    });
    const restrictedHistory = await f.service.history(f.member, { limit: 50 });
    expect(restrictedHistory.items).toHaveLength(1);
    await expect(
      f.service.history(f.member, { limit: 50, userId: f.owner.id }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await f.db.mediaUser.update({
      where: { id: f.owner.id },
      data: { role: "member" },
    });
    const demotedHistory = await f.service.history(f.owner, { limit: 50 });
    expect(demotedHistory.items).toHaveLength(0);
    await expect(
      f.service.importHistory(f.owner, f.input),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects changed source payload and seals the exact reviewed final session set", async () => {
    const f = await fixture();
    await f.service.importHistory(f.owner, f.input);
    const first = f.input.rows[0];
    if (first === undefined) throw new Error("Fixture row missing");
    await expect(
      f.service.importHistory(f.owner, {
        ...f.input,
        rows: [{ ...first, percent_complete: 87 }],
      }),
    ).rejects.toMatchObject({ code: "history_changed" });
    const sealed = await f.seal();
    expect(sealed.collectionStartedAt).toBe(f.time.now.toISOString());
    await expect(
      f.service.importHistory(f.owner, {
        ...f.input,
        rows: [{ ...first, id: "3" }],
      }),
    ).rejects.toMatchObject({ code: "history_sealed" });
    expect(await f.service.importHistory(f.owner, f.input)).toEqual({
      imported: 0,
      unchanged: 2,
    });
  });

  it("requires a sealed handoff and counts only fresh measured playing intervals", async () => {
    const f = await fixture();
    let sessions: PlexPlaybackSession[] = [
      {
        sessionId: "actual-plex-session",
        serverAccountId: "123",
        ratingKey: "live",
        title: "Live title",
        seriesTitle: null,
        mediaType: "movie",
        platform: "tvOS",
        playerId: "player",
        state: "playing",
        durationMs: 1_000_000,
        progressMs: 0,
        decision: "direct_play",
      },
    ];
    const collector = new PrismaPlaybackCollector(
      f.db,
      { sessions: () => Promise.resolve(sessions) },
      f.server,
      () => f.time.now,
    );
    expect(await collector.reconcile()).toEqual({ observed: 0, completed: 0 });
    expect(
      await f.db.playbackSession.count({
        where: { serverMachineId: f.server },
      }),
    ).toBe(0);
    await f.service.importHistory(f.owner, f.input);
    await f.seal();
    await f.db.plexIdentityMapping.create({
      data: {
        userId: f.member.id,
        serverMachineId: f.server,
        serverAccountId: "123",
        kind: "shared",
        verifiedAt: f.time.now,
      },
    });
    await collector.reconcile();
    const session = sessions[0];
    if (session === undefined) throw new Error("Live fixture missing");
    for (const offset of [60_000, 120_000]) {
      f.time.now = new Date(f.time.now.getTime() + 60_000);
      sessions = [{ ...session, progressMs: offset }];
      await collector.reconcile();
      await collector.reconcile();
    }
    f.time.now = new Date(f.time.now.getTime() + 60_000);
    sessions = [{ ...session, progressMs: 120_000, state: "paused" }];
    await collector.reconcile();
    sessions = [];
    f.time.now = new Date(f.time.now.getTime() + 60_000);
    await collector.reconcile();
    const live = await f.db.playbackSession.findFirstOrThrow({
      where: { serverMachineId: f.server, source: "plex" },
    });
    expect(live.watchedMs).toBe(120_000);
    expect(live.stoppedAt?.getTime()).toBe(f.time.now.getTime() - 60_000);
    expect(live.meaningfulProgressAt?.getTime()).toBe(
      f.time.now.getTime() - 120_000,
    );
    const history = await f.service.history(f.member, { limit: 50 });
    expect(history.items).toHaveLength(2);
  });
});
