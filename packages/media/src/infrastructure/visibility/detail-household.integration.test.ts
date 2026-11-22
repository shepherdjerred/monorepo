import { expect, test } from "vitest";
import {
  libraryEpisode,
  librarySeason,
  libraryTitle,
} from "#infrastructure/library/views/library.test-support.ts";
import { LibraryQuerySchema } from "#shared/household/library.ts";
import { automationTestHarness } from "#testing/automation.ts";
import {
  followersOf,
  namedMember,
  runningHousehold,
  titleApplications,
  titleHousehold,
} from "./household.test-support.ts";

const harness = automationTestHarness();

test("the household reads who follows a title by name, a member no one else's identifiers, and a restricted reader nothing", async () => {
  const db = harness.database();
  const { owner, member, housemate } = await titleHousehold(db);
  // A managed profile is a household member of its own; the owner asked for it.
  const kids = await namedMember(db, "Kids");
  const former = await namedMember(db, "Former");
  const { media, library } = titleApplications(db);
  const tag = `followers-${crypto.randomUUID()}`;
  // A series: a movie request's choice is fixed, and this test cancels and
  // excludes claims, which only a series permits without a new choice.
  const film = await libraryTitle(db, `${tag} series`, {
    kind: "series",
    followers: [member.id, housemate.id, kids.id],
    finished: [former.id],
  });
  const others = await db.mediaRequest.findMany({
    where: { mediaId: film.id, userId: { not: member.id } },
  });
  expect(others).toHaveLength(3);

  const asMember = await media.getMedia(member, film.id);
  expect(asMember.followers).toEqual([
    { displayName: "Mei", me: true },
    { displayName: "Kids", me: false },
    { displayName: "Sam", me: false },
  ]);
  // Names only: no other person's id and none of their requests' ids.
  expect(asMember.requests.map((request) => request.userId)).toEqual([
    member.id,
  ]);
  const body = JSON.stringify(asMember);
  for (const row of others) {
    expect(body).not.toContain(row.id);
    expect(body).not.toContain(row.userId);
  }
  // Someone whose own interest ended reads the same names, none of them theirs.
  expect(await followersOf(media, former, film.id)).toEqual([
    { displayName: "Kids", me: false },
    { displayName: "Mei", me: false },
    { displayName: "Sam", me: false },
  ]);

  // The owner reads the same field, and every request as before.
  const asOwner = await media.getMedia(owner, film.id);
  expect(asOwner.followers).toEqual([
    { displayName: "Kids", me: false },
    { displayName: "Mei", me: false },
    { displayName: "Sam", me: false },
  ]);
  expect(asOwner.requests.map((request) => request.userId).sort()).toEqual(
    [member.id, housemate.id, kids.id].sort(),
  );
  expect(
    asOwner.requests.map((request) => request.user.displayName).sort(),
  ).toEqual(["Kids", "Mei", "Sam"]);

  // The names are the claims the library's `temporary` rests on.
  const query = LibraryQuerySchema.parse({ query: tag });
  const page = await library.list(member, query);
  expect(page.items.map((item) => [item.id, item.policy])).toEqual([
    [film.id, "temporary"],
  ]);
  expect(asMember.policy).toBe("temporary");

  // A cancelled or excluded claim follows nothing.
  await db.mediaRequest.updateMany({
    where: { mediaId: film.id, userId: housemate.id },
    data: { active: false },
  });
  await db.mediaRequest.updateMany({
    where: { mediaId: film.id, userId: kids.id },
    data: { excluded: true },
  });
  expect(await followersOf(media, member, film.id)).toEqual([
    { displayName: "Mei", me: true },
  ]);

  // An account the owner restricted reads no names, its own included.
  await db.mediaUser.update({
    where: { id: member.id },
    data: { restricted: true },
  });
  const restricted = await media.getMedia(member, film.id);
  expect(restricted.followers).toBeNull();
  expect(restricted.policy).toBe("temporary");
  expect(restricted.requests.map((request) => request.userId)).toEqual([
    member.id,
  ]);
  await db.mediaUser.update({
    where: { id: owner.id },
    data: { restricted: true },
  });
  expect(await followersOf(media, owner, film.id)).toBeNull();
});

test("a title nobody follows has no followers, and one the reader may not open withholds them", async () => {
  const db = harness.database();
  const { owner, member, housemate } = await titleHousehold(db);
  const { media } = titleApplications(db);
  const tag = `unfollowed-${crypto.randomUUID()}`;
  const kept = await libraryTitle(db, `${tag} kept`, { keep: true });
  const finished = await libraryTitle(db, `${tag} finished`, {
    finished: [member.id],
  });
  for (const actor of [owner, member, housemate]) {
    expect(await media.getMedia(actor, kept.id)).toMatchObject({
      policy: "keep",
      followers: [],
    });
    expect(await media.getMedia(actor, finished.id)).toMatchObject({
      policy: "unclassified",
      followers: [],
    });
  }
  // A followed series in a Plex library the readers may not open, with an
  // episode filed in one they may: the episode opens, the series' names do not.
  const hidden = await libraryTitle(db, `${tag} hidden`, {
    kind: "series",
    section: "9",
    followers: [housemate.id],
  });
  const episode = await libraryEpisode(db, hidden.id, { season: 1, number: 1 });
  await db.mediaItem.update({
    where: { id: episode.id },
    data: { externalIds: { plexSectionId: "2" } },
  });
  for (const actor of [owner, member, housemate])
    expect(await media.getMedia(actor, episode.id)).toMatchObject({
      rootMediaId: hidden.id,
      followers: null,
    });
  await expect(media.getMedia(member, hidden.id)).rejects.toMatchObject({
    code: "plex_library_access_required",
  });
  // The same episode, for an owner who may open the series' library.
  await db.plexIdentityMapping.update({
    where: { userId: owner.id },
    data: { permittedSectionIds: ["1", "2", "9"] },
  });
  expect(await followersOf(media, owner, episode.id)).toEqual([
    { displayName: "Sam", me: false },
  ]);
});

test("a series is followed by those who follow the series itself; its seasons and episodes report them, and an episode's own claim names nobody", async () => {
  const db = harness.database();
  const { owner, member, housemate } = await titleHousehold(db);
  const { media } = titleApplications(db);
  const series = await libraryTitle(db, "Followed series", {
    kind: "series",
    followers: [member.id],
  });
  const season = await librarySeason(db, series.id, 1);
  const episode = await libraryEpisode(db, season.id, { season: 1, number: 1 });
  const root = await db.mediaRequest.findFirstOrThrow({
    where: { mediaId: series.id, userId: member.id },
  });
  // The series request reaches the episode as a spread row: still one follower.
  const spread = await db.mediaRequest.create({
    data: { mediaId: episode.id, userId: member.id, direct: false },
  });
  await db.requestCoverage.create({
    data: {
      rootRequestId: root.id,
      requestId: spread.id,
      mediaId: episode.id,
      sourceVersion: root.version,
    },
  });
  // The housemate asked for this one episode and nothing else of the series.
  const single = await db.mediaRequest.create({
    data: { mediaId: episode.id, userId: housemate.id },
  });
  for (const row of [series, season, episode]) {
    expect(await followersOf(media, member, row.id)).toEqual([
      { displayName: "Mei", me: true },
    ]);
    for (const actor of [owner, housemate])
      expect(await followersOf(media, actor, row.id)).toEqual([
        { displayName: "Mei", me: false },
      ]);
  }
  // The housemate still reads their own episode request on the episode's page.
  const page = await media.getMedia(housemate, episode.id);
  expect(page.requests.map((request) => request.id)).toEqual([single.id]);
});

test("a film and an episode report their own runtime; a series and a season report none", async () => {
  const db = harness.database();
  const { owner, member } = await titleHousehold(db);
  const { media } = titleApplications(db);
  const film = await libraryTitle(db, "Timed film", { keep: true });
  const series = await libraryTitle(db, "Timed series", {
    kind: "series",
    keep: true,
  });
  const season = await librarySeason(db, series.id, 1);
  const episode = await libraryEpisode(db, season.id, { season: 1, number: 1 });
  const runtime = (mediaId: string, runtimeMinutes: number | null) =>
    db.mediaItem.update({ where: { id: mediaId }, data: { runtimeMinutes } });
  await runtime(film.id, 132);
  await runtime(episode.id, 47);
  for (const actor of [owner, member]) {
    expect(await media.getMedia(actor, film.id)).toMatchObject({
      runtimeMinutes: 132,
    });
    expect(await media.getMedia(actor, episode.id)).toMatchObject({
      runtimeMinutes: 47,
    });
    // Nothing is summed or averaged from the episodes.
    for (const row of [series, season])
      expect(await media.getMedia(actor, row.id)).toMatchObject({
        runtimeMinutes: null,
      });
  }
  // TMDB sends 0 for a film whose runtime it does not know, and Media stores it.
  await runtime(film.id, 0);
  expect(await media.getMedia(member, film.id)).toMatchObject({
    runtimeMinutes: null,
  });
  await runtime(film.id, null);
  expect(await media.getMedia(member, film.id)).toMatchObject({
    runtimeMinutes: null,
  });
});

test("each request carries its own keeping policy, and Stop following is refused exactly while it is keep", async () => {
  const db = harness.database();
  await runningHousehold(db);
  const { owner, member, housemate } = await titleHousehold(db);
  const { media, interests } = titleApplications(db);
  const series = await libraryTitle(db, "Kept by one request", {
    kind: "series",
    followers: [member.id],
    keepers: [housemate.id],
  });
  const episode = await libraryEpisode(db, series.id, { season: 1, number: 1 });
  const root = await db.mediaRequest.findFirstOrThrow({
    where: { mediaId: series.id, userId: housemate.id },
  });
  const spread = await db.mediaRequest.create({
    data: {
      mediaId: episode.id,
      userId: housemate.id,
      direct: false,
      keepingPolicy: "keep",
    },
  });
  await db.requestCoverage.create({
    data: {
      rootRequestId: root.id,
      requestId: spread.id,
      mediaId: episode.id,
      sourceVersion: root.version,
    },
  });
  const policies = async (mediaId: string) => {
    const detail = await media.getMedia(owner, mediaId);
    return Object.fromEntries(
      detail.requests.map((request) => [request.userId, request.keepingPolicy]),
    );
  };
  expect(await policies(series.id)).toEqual({
    [member.id]: "temporary",
    [housemate.id]: "keep",
  });
  // A spread row has no interest of its own, whatever its column holds.
  expect(await policies(episode.id)).toEqual({ [housemate.id]: null });
  // The series is kept though its library switch is off: the request keeps it.
  const kept = await media.getMedia(housemate, series.id);
  expect(kept).toMatchObject({
    policy: "keep",
    followers: [
      { displayName: "Sam", me: true },
      { displayName: "Mei", me: false },
    ],
  });
  const [own] = kept.requests;
  if (own?.interestRevision == null)
    throw new Error("The housemate's request lost its interest");
  expect(own).toMatchObject({ userId: housemate.id, keepingPolicy: "keep" });
  await expect(
    interests.execute(housemate, crypto.randomUUID(), {
      schemaVersion: 1,
      requestId: own.id,
      expectedVersion: own.version,
      expectedInterestRevision: own.interestRevision,
      action: "drop",
    }),
  ).rejects.toMatchObject({ code: "keep_protected" });
  await interests.execute(owner, crypto.randomUUID(), {
    schemaVersion: 1,
    requestId: own.id,
    expectedVersion: own.version,
    expectedInterestRevision: own.interestRevision,
    action: "temporary",
  });
  const freed = await media.getMedia(housemate, series.id);
  const [temporary] = freed.requests;
  if (temporary?.interestRevision == null)
    throw new Error("The housemate's request lost its interest");
  expect(freed.policy).toBe("temporary");
  expect(temporary.keepingPolicy).toBe("temporary");
  expect(
    await interests.execute(housemate, crypto.randomUUID(), {
      schemaVersion: 1,
      requestId: temporary.id,
      expectedVersion: temporary.version,
      expectedInterestRevision: temporary.interestRevision,
      action: "drop",
    }),
  ).toMatchObject({ state: "dropped" });
  expect(await followersOf(media, housemate, series.id)).toEqual([
    { displayName: "Mei", me: false },
  ]);
});
