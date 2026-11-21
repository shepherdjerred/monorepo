import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import {
  commitClaims,
  first,
  graph,
} from "#infrastructure/plex-binding/schema/schema.test-support.ts";
import { PrismaPlaybackHistory } from "./service.ts";

let postgres: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  postgres = await startMediaTestPostgres();
});
afterAll(async () => {
  await postgres.close();
});

const SECTION = "1";
const artwork = { posterPath: "/poster.jpg", backdropPath: "/backdrop.jpg" };

/** One series whose two episodes Plex holds, and three plays: both episodes and an unclaimed key. */
async function fixture() {
  const db = postgres.database;
  const [group] = await graph(db, { leaves: 2 });
  if (group === undefined) throw new Error("Claim fixture missing");
  await commitClaims(db, [group]);
  const association = first(group).value;
  const server = association.access.serverMachineId;
  const seriesId = association.editionRootId;
  await db.mediaItem.update({ where: { id: seriesId }, data: artwork });
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
  const access = (userId: string, sectionId = SECTION) =>
    db.plexIdentityMapping.upsert({
      where: { userId },
      create: {
        userId,
        serverMachineId: server,
        kind: "shared",
        verifiedAt: new Date(),
        permittedSectionIds: [sectionId],
        permittedMediaKinds: ["series"],
      },
      update: { permittedSectionIds: [sectionId], verifiedAt: new Date() },
    });
  await access(owner.id);
  await access(member.id);
  const now = new Date();
  const plays = [
    ...group.associations.map((row) => row.value.item.ratingKey),
    "unclaimed",
  ];
  await db.playbackSession.createMany({
    data: plays.map((ratingKey, index) => ({
      serverMachineId: server,
      serverAccountId: "account",
      userId: member.id,
      ratingKey,
      title: `Play ${ratingKey}`,
      mediaType: "episode",
      platform: "tvOS",
      playerId: "player",
      decision: "direct_play",
      startedAt: new Date(now.getTime() - (index + 1) * 600_000),
      stoppedAt: new Date(now.getTime() - (index + 1) * 600_000 + 300_000),
      lastSeenAt: new Date(now.getTime() - (index + 1) * 600_000 + 300_000),
      durationMs: 300_000,
      watchedMs: 300_000,
      state: "stopped",
      source: "plex",
    })),
  });
  const episodes = await db.mediaItem.findMany({
    where: {
      id: { in: group.associations.map((row) => row.value.scope.mediaId) },
    },
  });
  const expected = new Map<string, unknown>(
    group.associations.map((row) => {
      const episode = episodes.find(
        (item) => item.id === row.value.scope.mediaId,
      );
      if (episode === undefined) throw new Error("Episode fixture missing");
      return [
        `Play ${row.value.item.ratingKey}`,
        {
          id: episode.id,
          rootMediaId: seriesId,
          kind: "episode",
          title: episode.title,
          artwork,
        },
      ];
    }),
  );
  expected.set("Play unclaimed", null);
  const service = new PrismaPlaybackHistory(
    db,
    { serverMachineId: server, sections: { series: SECTION } },
    () => now,
  );
  const links = (items: readonly { title: string; media: unknown }[]) =>
    new Map(items.map((item) => [item.title, item.media]));
  return { db, server, owner, member, access, now, service, expected, links };
}

describe("playback title links", () => {
  it("links each play to the title Plex holds and leaves an unclaimed play unlinked", async () => {
    const f = await fixture();
    const own = await f.service.history(f.member, { limit: 50 });
    expect(f.links(own.items)).toEqual(f.expected);
    const household = await f.service.history(f.owner, { limit: 50 });
    expect(f.links(household.items)).toEqual(f.expected);
  });

  it("links what is playing now", async () => {
    const f = await fixture();
    await f.db.playbackCollector.create({
      data: { serverMachineId: f.server, observedAt: f.now },
    });
    await f.db.playbackSession.updateMany({
      where: { serverMachineId: f.server },
      data: { state: "playing", stoppedAt: null },
    });
    const playing = await f.service.nowPlaying(f.member);
    expect(playing.stale).toBe(false);
    expect(f.links(playing.items)).toEqual(f.expected);
  });

  it("withholds every title from a reader outside the title's Plex section", async () => {
    const f = await fixture();
    await f.access(f.member.id, "2");
    const own = await f.service.history(f.member, { limit: 50 });
    expect(own.items.map((item) => item.media)).toEqual([null, null, null]);
    // The owner's own access, not the player's, decides what the owner is linked to.
    const household = await f.service.history(f.owner, { limit: 50 });
    expect(f.links(household.items)).toEqual(f.expected);
  });

  it("still returns plays, without titles, while the reader's Plex access is stale or missing", async () => {
    const f = await fixture();
    await f.db.plexIdentityMapping.update({
      where: { userId: f.member.id },
      data: { verifiedAt: new Date(Date.now() - 600_000) },
    });
    const stale = await f.service.history(f.member, { limit: 50 });
    expect(stale.items.map((item) => item.media)).toEqual([null, null, null]);
    await f.db.plexIdentityMapping.delete({ where: { userId: f.member.id } });
    const unmapped = await f.service.history(f.member, { limit: 50 });
    expect(unmapped.items.map((item) => item.media)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("does not follow another server's claim on the same rating key", async () => {
    // Both fixtures claim the same rating keys, each on its own server.
    const f = await fixture();
    const other = await fixture();
    expect([...f.expected.keys()]).toEqual([...other.expected.keys()]);
    expect(f.expected).not.toEqual(other.expected);
    const own = await f.service.history(f.member, { limit: 50 });
    expect(f.links(own.items)).toEqual(f.expected);
    const others = await other.service.history(other.member, { limit: 50 });
    expect(other.links(others.items)).toEqual(other.expected);
  });
});
