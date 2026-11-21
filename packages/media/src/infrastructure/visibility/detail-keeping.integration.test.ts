import { expect, test } from "vitest";
import type { MediaActor } from "#application/auth.ts";
import type { Database } from "#infrastructure/database.ts";
import { PrismaLibraryApplication } from "#infrastructure/library/views/library.ts";
import {
  libraryEpisode,
  libraryHousehold,
  libraryMember,
  librarySeason,
  libraryTitle,
} from "#infrastructure/library/views/library.test-support.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { RequestInterestCommands } from "#infrastructure/request-interest/commands.ts";
import { listRequestInterests } from "#infrastructure/request-interest/read.ts";
import {
  LibraryQuerySchema,
  type LibraryQuery,
} from "#shared/household/library.ts";
import { automationTestHarness } from "#testing/automation.ts";
import { grantTestLease } from "#testing/authority.ts";

const harness = automationTestHarness();
const settings = {
  serverMachineId: "fixture-server",
  sections: { movie: "1", series: "2" },
};

function applications(db: Database) {
  return {
    media: new PrismaMediaApplication(db, {
      keepDays: 30,
      serverMachineId: settings.serverMachineId,
      movieSectionId: settings.sections.movie,
      visibilitySections: settings.sections,
    }),
    library: new PrismaLibraryApplication(db, settings),
    interests: new RequestInterestCommands(db, { keepDays: 30 }),
  };
}

async function household(db: Database) {
  return {
    owner: await libraryMember(db, { sections: ["1", "2"], role: "owner" }),
    member: await libraryMember(db, { sections: ["1", "2"] }),
    housemate: await libraryMember(db, { sections: ["1", "2"] }),
  };
}

/** Commands, unlike reads, need a household that is running. */
async function running(db: Database) {
  await grantTestLease(db);
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", ownershipConfirmed: true, recoveryEpoch: 0 },
  });
}

async function targetVersion(db: Database, mediaId: string) {
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId, edition: "default" } },
  });
  return target.version;
}

type Applications = ReturnType<typeof applications>;

async function listedIds(
  library: Applications["library"],
  actor: MediaActor,
  query: LibraryQuery,
) {
  const page = await library.list(actor, query);
  return page.items.map((item) => item.id);
}

/** A title page's requests, as the fields this change adds beside each. */
async function requestsOf(
  media: Applications["media"],
  actor: MediaActor,
  mediaId: string,
) {
  const detail = await media.getMedia(actor, mediaId);
  return detail.requests
    .map((request) => ({
      id: request.id,
      userId: request.userId,
      interestRevision: request.interestRevision,
      interestState: request.interestState,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

test("a film's and a series' detail report the keeping their library item reports, the switch to the owner alone", async () => {
  const db = harness.database();
  const tag = `keeping-${crypto.randomUUID()}`;
  const { reader, owner, title } = await libraryHousehold(db, tag);
  const { media, library } = applications(db);
  const query = LibraryQuerySchema.parse({ query: tag, limit: 50 });
  const keeping = async (actor: MediaActor, mediaId: string) => {
    const detail = await media.getMedia(actor, mediaId);
    return { policy: detail.policy, libraryKeeping: detail.libraryKeeping };
  };
  for (const actor of [owner, reader]) {
    const { items } = await library.list(actor, query);
    expect(items.length).toBeGreaterThanOrEqual(13);
    for (const item of items)
      expect(await keeping(actor, item.id), item.title).toEqual({
        policy: item.policy,
        libraryKeeping: item.libraryKeeping,
      });
  }
  const switchOf = async (mediaId: string, keepingPolicy: string) => {
    const current = await db.mediaItem.findUniqueOrThrow({
      where: { id: mediaId },
    });
    return {
      mediaVersion: current.version,
      targetVersion: await targetVersion(db, mediaId),
      keepingPolicy,
    };
  };
  // A kept film, a film and a series someone follows, and a film nobody does.
  expect(await keeping(owner, title.a.id)).toEqual({
    policy: "keep",
    libraryKeeping: await switchOf(title.a.id, "keep"),
  });
  expect(await keeping(owner, title.c.id)).toEqual({
    policy: "temporary",
    libraryKeeping: await switchOf(title.c.id, "temporary"),
  });
  expect(await keeping(owner, title.i.id)).toEqual({
    policy: "temporary",
    libraryKeeping: await switchOf(title.i.id, "temporary"),
  });
  expect(await keeping(owner, title.e.id)).toEqual({
    policy: "unclassified",
    libraryKeeping: await switchOf(title.e.id, "temporary"),
  });
  // A housemate's keeping request keeps the film though its library switch is off.
  expect(await keeping(owner, title.b.id)).toEqual({
    policy: "keep",
    libraryKeeping: await switchOf(title.b.id, "temporary"),
  });
  // A member reads the same policy and never the switch.
  for (const [mediaId, policy] of [
    [title.a.id, "keep"],
    [title.b.id, "keep"],
    [title.c.id, "temporary"],
    [title.i.id, "temporary"],
    [title.e.id, "unclassified"],
  ] as const)
    expect(await keeping(reader, mediaId)).toEqual({
      policy,
      libraryKeeping: null,
    });
  // The stored role decides: a demoted or restricted owner loses the switch.
  await db.mediaUser.update({
    where: { id: owner.id },
    data: { restricted: true },
  });
  expect(await keeping(owner, title.a.id)).toEqual({
    policy: "keep",
    libraryKeeping: null,
  });
});

test("a season and an episode report their series' keeping, and its switch changes the series", async () => {
  const db = harness.database();
  await running(db);
  const { owner, member } = await household(db);
  const { media, interests } = applications(db);
  const series = await libraryTitle(db, "Kept series", {
    kind: "series",
    keep: true,
    followers: [member.id],
  });
  const season = await librarySeason(db, series.id, 1);
  // The episode has a target of its own that is not kept; it must never win.
  const episode = await libraryEpisode(db, season.id, { season: 1, number: 1 });
  await db.mediaItem.update({
    where: { id: series.id },
    data: { version: 7 },
  });
  const kept = {
    policy: "keep",
    libraryKeeping: {
      mediaVersion: 7,
      targetVersion: await targetVersion(db, series.id),
      keepingPolicy: "keep",
    },
  };
  for (const row of [series, season, episode]) {
    expect(await media.getMedia(owner, row.id)).toMatchObject({
      id: row.id,
      rootMediaId: series.id,
      ...kept,
    });
    expect(await media.getMedia(member, row.id)).toMatchObject({
      id: row.id,
      policy: "keep",
      libraryKeeping: null,
    });
  }
  // What the episode page read is what the keeping command expects.
  const page = await media.getMedia(owner, episode.id);
  if (page.libraryKeeping === null)
    throw new Error("The owner lost the keeping switch");
  const changed = await interests.libraryPolicy(owner, crypto.randomUUID(), {
    schemaVersion: 1,
    mediaId: page.rootMediaId,
    edition: "default",
    expectedMediaVersion: page.libraryKeeping.mediaVersion,
    expectedTargetVersion: page.libraryKeeping.targetVersion,
    keepingPolicy: "temporary",
  });
  // The member still follows the series, so without its Keep it is temporary.
  for (const row of [series, season, episode])
    expect(await media.getMedia(owner, row.id)).toMatchObject({
      policy: "temporary",
      libraryKeeping: {
        mediaVersion: changed.mediaVersion,
        targetVersion: changed.targetVersion,
        keepingPolicy: "temporary",
      },
    });
});

test("a title the library does not list reports no keeping", async () => {
  const db = harness.database();
  await running(db);
  const { owner, member } = await household(db);
  const { media, library, interests } = applications(db);
  const tag = `unlisted-${crypto.randomUUID()}`;
  const absent = { policy: "unclassified", libraryKeeping: null };
  // Nothing holds this film: no Keep, no standing request, no file.
  const unheld = await libraryTitle(db, `${tag} unheld`, {});
  // A kept series in a Plex library the member may not open, with an episode
  // filed in one they may.
  const hidden = await libraryTitle(db, `${tag} hidden`, {
    kind: "series",
    keep: true,
    section: "9",
  });
  const episode = await libraryEpisode(db, hidden.id, { season: 1, number: 1 });
  await db.mediaItem.update({
    where: { id: episode.id },
    data: { externalIds: { plexSectionId: "2" } },
  });
  const query = LibraryQuerySchema.parse({ query: tag });
  for (const actor of [owner, member]) {
    expect(await listedIds(library, actor, query)).toEqual([]);
    expect(await media.getMedia(actor, unheld.id)).toMatchObject(absent);
    expect(await media.getMedia(actor, episode.id)).toMatchObject({
      rootMediaId: hidden.id,
      ...absent,
    });
  }
  // The same series, for an owner who may open its library.
  await db.plexIdentityMapping.update({
    where: { userId: owner.id },
    data: { permittedSectionIds: ["1", "2", "9"] },
  });
  expect(await listedIds(library, owner, query)).toEqual([hidden.id]);
  expect(await media.getMedia(owner, episode.id)).toMatchObject({
    policy: "keep",
    libraryKeeping: { keepingPolicy: "keep" },
  });
  // A film held by its Keep alone leaves the library with it, and the switch
  // goes too: the title page offers what the library list offers.
  const kept = await libraryTitle(db, `${tag} kept`, { keep: true });
  const page = await media.getMedia(owner, kept.id);
  if (page.libraryKeeping === null)
    throw new Error("The owner lost the keeping switch");
  expect(page).toMatchObject({
    policy: "keep",
    libraryKeeping: { keepingPolicy: "keep" },
  });
  await interests.libraryPolicy(owner, crypto.randomUUID(), {
    schemaVersion: 1,
    mediaId: kept.id,
    edition: "default",
    expectedMediaVersion: page.libraryKeeping.mediaVersion,
    expectedTargetVersion: page.libraryKeeping.targetVersion,
    keepingPolicy: "temporary",
  });
  expect(await listedIds(library, owner, query)).toEqual([hidden.id]);
  expect(await media.getMedia(owner, kept.id)).toMatchObject(absent);
});

test("each request carries its interest, a member reads only their own, and Stop following accepts what the detail reported", async () => {
  const db = harness.database();
  await running(db);
  const { owner, member, housemate } = await household(db);
  const { media, interests } = applications(db);
  const series = await libraryTitle(db, "Followed series", { kind: "series" });
  const episode = await libraryEpisode(db, series.id, { season: 1, number: 1 });
  const mine = await db.mediaRequest.create({
    data: { mediaId: series.id, userId: member.id, interestRevision: 4 },
  });
  const theirs = await db.mediaRequest.create({
    data: { mediaId: series.id, userId: housemate.id },
  });
  // The series request reaches its episode as a row with no interest of its own.
  const spread = await db.mediaRequest.create({
    data: { mediaId: episode.id, userId: member.id, direct: false },
  });
  await db.requestCoverage.create({
    data: {
      rootRequestId: mine.id,
      requestId: spread.id,
      mediaId: episode.id,
      sourceVersion: mine.version,
    },
  });
  const requests = (actor: MediaActor, mediaId: string) =>
    requestsOf(media, actor, mediaId);
  const own = {
    id: mine.id,
    userId: member.id,
    interestRevision: 4,
    interestState: "following",
  };
  const other = {
    id: theirs.id,
    userId: housemate.id,
    interestRevision: 0,
    interestState: "following",
  };
  expect(await requests(member, series.id)).toEqual([own]);
  expect(await requests(housemate, series.id)).toEqual([other]);
  expect(await requests(owner, series.id)).toEqual(
    [own, other].sort((left, right) => left.id.localeCompare(right.id)),
  );
  // The detail names an interest exactly as the interests read does.
  const listed = await listRequestInterests(db, member, null);
  expect(
    listed.items.map((interest) => ({
      id: interest.requestId,
      userId: interest.userId,
      interestRevision: interest.interestRevision,
      interestState: interest.interestState,
    })),
  ).toEqual([own]);
  const withoutInterest = {
    id: spread.id,
    userId: member.id,
    interestRevision: null,
    interestState: null,
  };
  expect(await requests(member, episode.id)).toEqual([withoutInterest]);
  expect(await requests(owner, episode.id)).toEqual([withoutInterest]);
  expect(await requests(housemate, episode.id)).toEqual([]);
  // A row without an interest has none to command.
  await expect(
    interests.execute(member, crypto.randomUUID(), {
      schemaVersion: 1,
      requestId: spread.id,
      expectedVersion: spread.version,
      expectedInterestRevision: spread.interestRevision,
      action: "drop",
    }),
  ).rejects.toMatchObject({ code: "root_request_required" });
  // A direct request the member dropped still stands while the series covers it.
  await db.mediaRequest.update({
    where: { id: spread.id },
    data: { direct: true, interestState: "dropped", interestRevision: 2 },
  });
  expect(await requests(member, episode.id)).toEqual([
    { ...withoutInterest, interestRevision: 2, interestState: "dropped" },
  ]);
  const page = await media.getMedia(member, series.id);
  const [entry] = page.requests;
  if (entry?.interestRevision == null)
    throw new Error("The member's request lost its interest");
  await expect(
    interests.execute(member, crypto.randomUUID(), {
      schemaVersion: 1,
      requestId: entry.id,
      expectedVersion: entry.version,
      expectedInterestRevision: entry.interestRevision + 1,
      action: "drop",
    }),
  ).rejects.toMatchObject({ code: "version_conflict" });
  expect(
    await interests.execute(member, crypto.randomUUID(), {
      schemaVersion: 1,
      requestId: entry.id,
      expectedVersion: entry.version,
      expectedInterestRevision: entry.interestRevision,
      action: "drop",
    }),
  ).toMatchObject({ state: "dropped", interestRevision: 5 });
  // A released request is no longer one the title page lists.
  expect(await requests(member, series.id)).toEqual([]);
  expect(await requests(owner, series.id)).toEqual([other]);
});
