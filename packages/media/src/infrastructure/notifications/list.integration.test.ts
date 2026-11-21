import { afterAll, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { readNotificationList } from "./list.ts";

let postgres: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  postgres = await startMediaTestPostgres();
});
afterAll(async () => {
  await postgres.close();
});

const movieArt = { posterPath: "/movie.jpg", backdropPath: null };
const seriesArt = {
  posterPath: "/series.jpg",
  backdropPath: "/series-wide.jpg",
};
const RECORDED = Date.parse("2026-11-01T12:00:00.000Z");

/** A movie, and an episode two levels under its series. */
async function library() {
  const db = postgres.database;
  const movie = await db.mediaItem.create({
    data: { kind: "movie", title: "Dune", ...movieArt },
  });
  const series = await db.mediaItem.create({
    data: { kind: "series", title: "Severance", ...seriesArt },
  });
  const season = await db.mediaItem.create({
    data: {
      kind: "season",
      title: "Season 1",
      parentId: series.id,
      seasonNumber: 1,
    },
  });
  const episode = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Good News About Hell",
      parentId: season.id,
      seasonNumber: 1,
      episodeNumber: 1,
      // A still of its own must not pass as the art of the series.
      posterPath: "/episode-still.jpg",
    },
  });
  return { movie, series, episode };
}

/** One event delivered to `userId` on each channel, `minutes` after the others. */
async function deliver(
  userId: string,
  event: { kind: string; mediaId: string | null },
  channels: readonly string[],
  minutes: number,
) {
  const db = postgres.database;
  const recorded = await db.applicationEvent.create({
    data: { ...event, payload: {} },
  });
  for (const [index, channel] of channels.entries())
    await db.notificationDelivery.create({
      data: {
        eventId: recorded.id,
        userId,
        channel,
        state: "accepted",
        // A second apart, so the list's newest-first order is the order given.
        createdAt: new Date(RECORDED + minutes * 60_000 - index * 1000),
      },
    });
  return recorded.id;
}

function user(displayName: string, role: "owner" | "member") {
  return postgres.database.mediaUser.create({
    data: { plexAccountId: crypto.randomUUID(), displayName, role },
  });
}

test("each delivery names its event and the title it is about: a movie, an episode under its series, and nothing for no item or a deleted one", async () => {
  const db = postgres.database;
  const { movie, series, episode } = await library();
  const member = await user("Member", "member");
  const other = await user("Other member", "member");
  const deleted = crypto.randomUUID();
  const available = await deliver(
    member.id,
    { kind: "media_available", mediaId: movie.id },
    ["email", "discord"],
    4,
  );
  const aired = await deliver(
    member.id,
    { kind: "media_available", mediaId: episode.id },
    ["email"],
    3,
  );
  const verification = await deliver(
    member.id,
    { kind: "email_verification", mediaId: null },
    ["email"],
    2,
  );
  const purged = await deliver(
    member.id,
    { kind: "files_purged", mediaId: deleted },
    ["email"],
    1,
  );
  await deliver(
    other.id,
    { kind: "media_available", mediaId: movie.id },
    ["email"],
    5,
  );

  const list = await readNotificationList(db, member);
  const dune = {
    id: movie.id,
    rootMediaId: movie.id,
    rootTitle: "Dune",
    kind: "movie",
    title: "Dune",
    artwork: movieArt,
  };
  const arrival = {
    id: available,
    mediaId: movie.id,
    kind: "media_available",
    media: dune,
  };
  // Newest first; the two channels of one event carry the same event.
  expect(list.map((row) => [row.channel, row.event])).toEqual([
    ["email", arrival],
    ["discord", arrival],
    [
      "email",
      {
        id: aired,
        mediaId: episode.id,
        kind: "media_available",
        media: {
          id: episode.id,
          rootMediaId: series.id,
          rootTitle: "Severance",
          kind: "episode",
          title: "Good News About Hell",
          artwork: seriesArt,
        },
      },
    ],
    [
      "email",
      {
        id: verification,
        mediaId: null,
        kind: "email_verification",
        media: null,
      },
    ],
    [
      "email",
      { id: purged, mediaId: deleted, kind: "files_purged", media: null },
    ],
  ]);
});

test("an intervention names its title to an owner, and not once its reader is no longer one", async () => {
  const db = postgres.database;
  const { movie } = await library();
  const owner = await user("Owner", "owner");
  const intervention = await deliver(
    owner.id,
    { kind: "system_intervention", mediaId: movie.id },
    ["email"],
    1,
  );

  const asOwner = await readNotificationList(db, owner);
  expect(asOwner.map((row) => row.event)).toEqual([
    {
      id: intervention,
      mediaId: movie.id,
      kind: "system_intervention",
      media: {
        id: movie.id,
        rootMediaId: movie.id,
        rootTitle: "Dune",
        kind: "movie",
        title: "Dune",
        artwork: movieArt,
      },
    },
  ]);
  const demoted = await db.mediaUser.update({
    where: { id: owner.id },
    data: { role: "member" },
  });
  const asMember = await readNotificationList(db, demoted);
  expect(asMember.map((row) => row.event)).toEqual([
    {
      id: intervention,
      mediaId: movie.id,
      kind: "system_intervention",
      media: null,
    },
  ]);
});
