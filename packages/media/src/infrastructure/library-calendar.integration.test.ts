import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { externalLibraryFixture } from "#testing/external-library-fixture.ts";
import { PrismaCalendarApplication } from "#infrastructure/library/views/calendar.ts";
import { readCatalogLibraryState } from "#infrastructure/library/views/catalog-state.ts";
import { PrismaLibraryApplication } from "#infrastructure/library/views/library.ts";
import { PrismaRemovalHistoryApplication } from "#infrastructure/library/views/removals.ts";
import {
  CalendarQuerySchema,
  RemovalHistoryQuerySchema,
} from "#shared/household/calendar.ts";
import { LibraryQuerySchema } from "#shared/household/library.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import type { MediaActor } from "#application/auth.ts";
import {
  daysAgo,
  libraryEpisode,
  libraryHousehold,
  libraryMember,
  librarySeason,
  libraryTitle,
} from "#infrastructure/library/views/library.test-support.ts";

const harness = automationTestHarness();
const settings = {
  serverMachineId: "fixture-server",
  sections: { movie: "1", series: "2" },
};

test("subtitle authority guards preserve unrelated application-event writes and protect download history", async () => {
  const db = harness.database();
  const eventId = crypto.randomUUID();
  expect(
    await db.$executeRaw`INSERT INTO "ApplicationEvent" (id,kind,payload) VALUES (${eventId},'calendar_guard_control','{}'::jsonb)`,
  ).toBe(1);
  expect(
    await db.applicationEvent.update({
      where: { id: eventId },
      data: { payload: { observed: true } },
    }),
  ).toMatchObject({ id: eventId, payload: { observed: true } });
  await db.applicationEvent.delete({ where: { id: eventId } });
  expect(
    await db.applicationEvent.findUnique({ where: { id: eventId } }),
  ).toBeNull();

  const download = await db.applicationEvent.create({
    data: {
      kind: "subtitle_download_requested",
      payload: { candidateId: "guard-control" },
    },
  });
  await expect(
    db.$executeRaw`UPDATE "ApplicationEvent" SET payload='{}'::jsonb WHERE id=${download.id}`,
  ).rejects.toThrow("Automatic subtitle authority events are immutable");
  await expect(
    db.$executeRaw`DELETE FROM "ApplicationEvent" WHERE id=${download.id}`,
  ).rejects.toThrow("Automatic subtitle authority events are immutable");
  expect(
    await db.applicationEvent.findUnique({ where: { id: download.id } }),
  ).toMatchObject({
    kind: "subtitle_download_requested",
    payload: { candidateId: "guard-control" },
  });
});

test("library and calendar show proved external presence without taking ownership, and enforce fresh access", async () => {
  const db = harness.database();
  const fixture = await externalLibraryFixture(db);
  await fixture.register();
  await db.mediaIntent.update({
    where: {
      mediaId_edition: { mediaId: fixture.media.id, edition: "default" },
    },
    data: { libraryKeep: true },
  });
  await db.mediaReleaseDate.create({
    data: {
      id: crypto.randomUUID(),
      mediaId: fixture.media.id,
      region: "US",
      kind: "digital",
      date: "2026-11-13",
      precision: "day",
      observedAt: new Date(),
    },
  });
  const observedSettings = {
    ...settings,
    serverMachineId: fixture.access.serverMachineId,
  };
  const library = new PrismaLibraryApplication(db, observedSettings);
  const calendar = new PrismaCalendarApplication(db, observedSettings);
  const before = await db.libraryAsset.findMany({ orderBy: { id: "asc" } });
  const libraryPage = await library.list(
    fixture.owner,
    LibraryQuerySchema.parse({}),
  );
  const calendarPage = await calendar.list(
    fixture.owner,
    CalendarQuerySchema.parse({
      from: "2026-11-01",
      to: "2026-11-30",
      status: "available",
    }),
  );
  expect(
    libraryPage.items.find((row) => row.id === fixture.media.id),
  ).toMatchObject({ availability: "available", policy: "keep" });
  expect(
    calendarPage.events.find((row) => row.mediaId === fixture.media.id),
  ).toMatchObject({ availability: "available", date: "2026-11-13" });
  expect(await db.libraryAsset.findMany({ orderBy: { id: "asc" } })).toEqual(
    before,
  );
  // The availability filter follows the proof, not the title's own state.
  const filtered = async (availability: string) => {
    const page = await library.list(
      fixture.owner,
      LibraryQuerySchema.parse({ query: fixture.media.title, availability }),
    );
    return page.items.map((row) => row.id);
  };
  expect(await filtered("available")).toEqual([fixture.media.id]);
  expect(await filtered("unavailable")).toEqual([]);
  await db.plexIdentityMapping.update({
    where: { userId: fixture.owner.id },
    data: { verifiedAt: new Date(Date.now() - 301_000) },
  });
  await expect(
    library.list(fixture.owner, LibraryQuerySchema.parse({})),
  ).rejects.toMatchObject({ code: "plex_library_access_required" });
  await expect(
    calendar.list(
      fixture.owner,
      CalendarQuerySchema.parse({ from: "2026-11-01", to: "2026-11-30" }),
    ),
  ).rejects.toMatchObject({ code: "plex_library_access_required" });
});

test("former requesters retain their own completed removal history without household watch details or external disappearance claims", async () => {
  const db = harness.database();
  const fixture = await harness.fixture("history", {
    chooseMovieEdition: false,
  });
  const actor = { ...fixture.user, role: "member" as const };
  const request = await db.mediaRequest.findUniqueOrThrow({
    where: {
      userId_mediaId_edition: {
        userId: actor.id,
        mediaId: fixture.media.id,
        edition: "default",
      },
    },
  });
  await new PrismaMediaApplication(db, { keepDays: 30 }).cancelRequest(
    actor,
    crypto.randomUUID(),
    request.id,
    request.version,
  );
  const quarantineTime = new Date("2026-11-01T00:00:00Z");
  const decision = await db.retentionDecision.create({
    data: {
      mediaId: fixture.media.id,
      generation: 1,
      state: "purged",
      evidence: {
        recoveryEpoch: 0,
        removalReason: "temporary_interest_released",
        secretHouseholdWatch: "PRIVATE",
      },
      quarantinedAt: quarantineTime,
      purgeAfter: new Date("2026-11-08T00:00:00Z"),
      manifest: { assets: [] },
    },
  });
  await db.applicationEvent.create({
    data: {
      mediaId: fixture.media.id,
      kind: "files_purged",
      payload: { decisionId: decision.id },
      createdAt: new Date("2026-11-08T01:00:00Z"),
    },
  });
  await db.retentionDecision.create({
    data: {
      mediaId: fixture.media.id,
      generation: 1,
      state: "purged",
      evidence: { recoveryEpoch: 0 },
      manifest: { assets: [] },
    },
  });
  const history = new PrismaRemovalHistoryApplication(db, settings);
  const result = await history.list(actor, RemovalHistoryQuerySchema.parse({}));
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({
    id: decision.id,
    requesterContext: "your_request",
    restoreState: "reacquire",
    reason: "temporary_interest_released",
    purgedAt: "2026-11-08T01:00:00.000Z",
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  const unrelated = await db.mediaUser.create({
    data: { plexAccountId: crypto.randomUUID(), displayName: "Unrelated" },
  });
  await db.plexIdentityMapping.create({
    data: {
      userId: unrelated.id,
      serverMachineId: "fixture-server",
      serverAccountId: unrelated.plexAccountId,
      kind: "account",
      permittedSectionIds: ["1"],
      permittedMediaKinds: ["movie"],
      verifiedAt: new Date(),
    },
  });
  const unrelatedHistory = await history.list(
    { ...unrelated, role: "member" },
    RemovalHistoryQuerySchema.parse({}),
  );
  expect(unrelatedHistory.items).toEqual([]);
});

test("library, calendar and removal history rows carry their title's artwork, and none before it is observed", async () => {
  const db = harness.database();
  const f = await harness.fixture("artwork", { chooseMovieEdition: false });
  const actor = { ...f.user, role: "member" as const };
  const title = `Artwork fixture ${crypto.randomUUID()}`;
  const art = {
    posterPath: "/artwork-poster.jpg",
    backdropPath: "/artwork-backdrop.jpg",
  };
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: { title, ...art },
  });
  await db.mediaReleaseDate.create({
    data: {
      id: crypto.randomUUID(),
      mediaId: f.media.id,
      region: "US",
      kind: "digital",
      date: "2026-11-20",
      precision: "day",
      observedAt: new Date(),
    },
  });
  const decision = await db.retentionDecision.create({
    data: {
      mediaId: f.media.id,
      generation: 1,
      state: "purged",
      evidence: { recoveryEpoch: 0 },
      quarantinedAt: new Date("2026-11-01T00:00:00Z"),
      manifest: { assets: [] },
    },
  });
  const library = new PrismaLibraryApplication(db, settings);
  const calendar = new PrismaCalendarApplication(db, settings);
  const history = new PrismaRemovalHistoryApplication(db, settings);
  const read = async () => {
    const libraryPage = await library.list(
      actor,
      LibraryQuerySchema.parse({ query: title }),
    );
    const calendarPage = await calendar.list(
      actor,
      CalendarQuerySchema.parse({ from: "2026-11-01", to: "2026-11-30" }),
    );
    const historyPage = await history.list(
      actor,
      RemovalHistoryQuerySchema.parse({}),
    );
    return {
      library: libraryPage.items,
      event: calendarPage.events.find((row) => row.mediaId === f.media.id),
      removal: historyPage.items.find((row) => row.id === decision.id),
    };
  };
  const observed = await read();
  expect(observed.library).toMatchObject([{ id: f.media.id, artwork: art }]);
  expect(observed.event).toMatchObject({
    rootMediaId: f.media.id,
    artwork: art,
  });
  expect(observed.removal).toMatchObject({
    mediaId: f.media.id,
    rootMediaId: f.media.id,
    artwork: art,
  });
  const none = { posterPath: null, backdropPath: null };
  await db.mediaItem.update({ where: { id: f.media.id }, data: none });
  const unobserved = await read();
  expect(unobserved.library).toMatchObject([{ artwork: none }]);
  expect(unobserved.event).toMatchObject({ artwork: none });
  expect(unobserved.removal).toMatchObject({ artwork: none });
});

test("calendar and removal history episodes retain their followed series identity and artwork with or without an intermediate season", async () => {
  const db = harness.database();
  const f = await harness.fixture("calendar", {
    chooseMovieEdition: false,
    kind: "episode",
  });
  const art = {
    posterPath: "/followed-poster.jpg",
    backdropPath: "/followed-backdrop.jpg",
  };
  const series = await db.mediaItem.create({
    data: { kind: "series", title: "Followed series", ...art },
  });
  const season = await db.mediaItem.create({
    data: {
      kind: "season",
      title: "Season 1",
      parentId: series.id,
      seasonNumber: 1,
    },
  });
  await db.mediaItem.update({
    where: { id: f.media.id },
    data: { parentId: series.id, seasonNumber: 1, episodeNumber: 1 },
  });
  const nested = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Nested episode",
      parentId: season.id,
      seasonNumber: 1,
      episodeNumber: 2,
    },
  });
  await db.$transaction((tx) =>
    lockDefaultScopes(tx, [{ mediaId: series.id, edition: "default" }], {
      createMissing: true,
    }),
  );
  await db.mediaRequest.create({
    data: { mediaId: series.id, userId: f.user.id },
  });
  for (const mediaId of [f.media.id, nested.id])
    await db.mediaReleaseDate.create({
      data: {
        id: `episode:${mediaId}`,
        mediaId,
        region: "",
        kind: "episode",
        date: "2026-11-15",
        precision: "day",
        observedAt: new Date(),
      },
    });
  const page = await new PrismaCalendarApplication(db, settings).list(
    { ...f.user, role: "member" },
    CalendarQuerySchema.parse({ from: "2026-11-01", to: "2026-11-30" }),
  );
  for (const mediaId of [f.media.id, nested.id])
    expect(
      page.events.find((event) => event.mediaId === mediaId),
    ).toMatchObject({
      rootMediaId: series.id,
      seriesTitle: series.title,
      artwork: art,
    });
  // The fixture episode sits directly under the series and has its own request.
  const decision = await db.retentionDecision.create({
    data: {
      mediaId: f.media.id,
      generation: 1,
      state: "purged",
      evidence: { recoveryEpoch: 0 },
      quarantinedAt: new Date("2026-11-01T00:00:00Z"),
      manifest: { assets: [] },
    },
  });
  const removals = await new PrismaRemovalHistoryApplication(db, settings).list(
    { ...f.user, role: "member" },
    RemovalHistoryQuerySchema.parse({}),
  );
  expect(removals.items.find((row) => row.id === decision.id)).toMatchObject({
    mediaId: f.media.id,
    kind: "episode",
    rootMediaId: series.id,
    artwork: art,
  });
});

type LibraryItems = Awaited<
  ReturnType<PrismaLibraryApplication["list"]>
>["items"];

/** Follow `nextCursor` until the library runs out, as "load more" does. */
async function readLibrary(
  actor: MediaActor,
  query: Record<string, string | number>,
) {
  const library = new PrismaLibraryApplication(harness.database(), settings);
  const sizes: number[] = [];
  const items: LibraryItems = [];
  let cursor: string | null = null;
  do {
    const page: Awaited<ReturnType<typeof library.list>> = await library.list(
      actor,
      LibraryQuerySchema.parse({ ...query, cursor }),
    );
    sizes.push(page.items.length);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return { sizes, items, ids: items.map((item) => item.id) };
}

async function libraryIds(
  actor: MediaActor,
  query: Record<string, string | number>,
) {
  const read = await readLibrary(actor, query);
  return read.ids;
}

function ids(...rows: { id: string }[]) {
  return rows.map((row) => row.id);
}

test("current visible episode coverage lists a series with no series target or request", async () => {
  const db = harness.database();
  const tag = crypto.randomUUID();
  const tmdbBase = Math.floor(Math.random() * 100_000_000);
  const reader = await libraryMember(db, { sections: ["2"] });
  const owner = await libraryMember(db, {
    sections: ["2", "9"],
    role: "owner",
  });
  async function imported(
    name: string,
    offset: number,
    options: {
      seasonSection?: string;
      episodeSection?: string;
      rootSection?: string;
      coverage?: "current" | "superseded" | "none";
    } = {},
  ) {
    const externalIds = (section: string | undefined) =>
      section === undefined ? {} : { plexSectionId: section };
    const externalId = tmdbBase + offset;
    const root = await db.mediaItem.create({
      data: {
        kind: "series",
        title: `${tag} ${name}`,
        tmdbId: externalId,
        externalIds: externalIds(options.rootSection),
      },
    });
    if (options.coverage === "none")
      return { ...root, key: { kind: "series" as const, externalId } };
    const parent =
      options.seasonSection === undefined
        ? root
        : await db.mediaItem.create({
            data: {
              kind: "season",
              title: "Season 1",
              seasonNumber: 1,
              parentId: root.id,
              externalIds: externalIds(options.seasonSection),
            },
          });
    const current = options.coverage !== "superseded";
    const episode = await libraryEpisode(db, parent.id, {
      season: 1,
      number: 1,
      availability: current ? "available" : "wanted",
      keep: true,
      files: [{ recordedAt: daysAgo(30 - offset), current }],
    });
    if (options.episodeSection !== undefined)
      await db.mediaItem.update({
        where: { id: episode.id },
        data: { externalIds: externalIds(options.episodeSection) },
      });
    return { ...root, key: { kind: "series" as const, externalId } };
  }

  const direct = await imported("A", 1);
  const nested = await imported("B", 2, {
    seasonSection: "2",
  });
  const otherSection = [
    await imported("C", 3, { episodeSection: "9" }),
    await imported("D", 4, { seasonSection: "9" }),
    await imported("E", 5, { rootSection: "9", episodeSection: "2" }),
    await imported("F", 6, { seasonSection: "9", episodeSection: "2" }),
  ];
  const old = await imported("G", 7, { coverage: "superseded" });
  const shell = await imported("H", 8, { coverage: "none" });
  const query = { query: tag, kind: "series" };
  const library = await readLibrary(reader, { ...query, limit: 1 });
  expect(library.ids).toEqual(ids(direct, nested));
  for (const item of library.items)
    expect(item).toMatchObject({
      episodes: { available: 1, total: 1 },
      policy: "unclassified",
      libraryKeeping: null,
    });
  expect(
    await libraryIds(reader, { ...query, sort: "added", limit: 1 }),
  ).toEqual(ids(nested, direct));
  expect(
    await libraryIds(reader, { ...query, availability: "available" }),
  ).toEqual(ids(direct, nested));
  expect(await libraryIds(reader, { ...query, policy: "keep" })).toEqual([]);
  expect(await libraryIds(owner, query)).toEqual(
    ids(direct, nested, ...otherSection),
  );

  const catalog = await readCatalogLibraryState(
    db,
    settings,
    reader,
    [direct, nested, ...otherSection, old, shell].map(({ key }) => key),
  );
  for (const row of [direct, nested])
    expect(catalog.state(row.key)).toMatchObject({
      mediaId: row.id,
      episodes: { available: 1, total: 1 },
      requested: false,
    });
  for (const row of [...otherSection, old, shell])
    expect(catalog.state(row.key)).toBeNull();
});

test("the library pages by title and by date added, an upgrade does not move a title, and a cursor pages only the sort that issued it", async () => {
  const db = harness.database();
  const tag = crypto.randomUUID();
  const reader = await libraryMember(db, { sections: ["1", "2"] });
  const recorded = {
    alpha: daysAgo(30),
    bravo: daysAgo(50),
    episode: daysAgo(1),
    tied: daysAgo(10),
  };
  const playing = { availability: "available" } as const;
  const alpha = await libraryTitle(db, `${tag} Alpha`, {
    ...playing,
    keep: true,
    files: [{ recordedAt: recorded.alpha, current: true }],
  });
  // Upgraded two days ago; the file it replaced was recorded fifty days ago.
  const bravo = await libraryTitle(db, `${tag} Bravo`, {
    ...playing,
    followers: [reader.id],
    files: [
      { recordedAt: recorded.bravo, current: false },
      { recordedAt: daysAgo(2), current: true },
    ],
  });
  // Asked for, nothing yet.
  const charlie = await libraryTitle(db, `${tag} Charlie`, {
    followers: [reader.id],
  });
  // A series is as new as its newest playable episode.
  const delta = await libraryTitle(db, `${tag} Delta`, {
    kind: "series",
    followers: [reader.id],
  });
  const season = await librarySeason(db, delta.id, 1);
  await libraryEpisode(db, delta.id, {
    ...playing,
    season: 1,
    number: 1,
    files: [{ recordedAt: daysAgo(40), current: true }],
  });
  await libraryEpisode(db, season.id, {
    ...playing,
    season: 1,
    number: 2,
    files: [{ recordedAt: recorded.episode, current: true }],
  });
  await libraryEpisode(db, season.id, { season: 1, number: 3 });
  // Its only file was removed: nothing to play, so no date.
  const echo = await libraryTitle(db, `${tag} Echo`, {
    keep: true,
    files: [{ recordedAt: daysAgo(5), current: false }],
  });
  const tied = [];
  for (const name of ["Foxtrot", "Golf"])
    tied.push(
      await libraryTitle(db, `${tag} ${name}`, {
        ...playing,
        keep: true,
        files: [{ recordedAt: recorded.tied, current: true }],
      }),
    );
  const [foxtrot, golf] = tied;
  if (foxtrot === undefined || golf === undefined)
    throw new Error("Missing tied titles");

  const byTitle = await readLibrary(reader, { query: tag, limit: 3 });
  expect(byTitle.sizes).toEqual([3, 3, 1]);
  expect(byTitle.ids).toEqual(
    [alpha, bravo, charlie, delta, echo, foxtrot, golf].map((row) => row.id),
  );
  expect(
    Object.fromEntries(byTitle.items.map((item) => [item.id, item.addedAt])),
  ).toEqual({
    [alpha.id]: recorded.alpha.toISOString(),
    [bravo.id]: recorded.bravo.toISOString(),
    [charlie.id]: null,
    [delta.id]: recorded.episode.toISOString(),
    [echo.id]: null,
    [foxtrot.id]: recorded.tied.toISOString(),
    [golf.id]: recorded.tied.toISOString(),
  });

  // Newest first, ties by id, and only what can be played.
  const newestFirst = [
    delta,
    ...[foxtrot, golf].sort((left, right) => (left.id < right.id ? 1 : -1)),
    alpha,
    bravo,
  ].map((row) => row.id);
  const byAdded = await readLibrary(reader, {
    query: tag,
    sort: "added",
    limit: 1,
  });
  expect(byAdded.sizes).toEqual([1, 1, 1, 1, 1]);
  expect(byAdded.ids).toEqual(newestFirst);
  expect(byAdded.items.map((item) => item.addedAt)).toEqual(
    [
      recorded.episode,
      recorded.tied,
      recorded.tied,
      recorded.alpha,
      recorded.bravo,
    ].map((date) => date.toISOString()),
  );
  expect(
    await libraryIds(reader, { query: tag, sort: "added", limit: 50 }),
  ).toEqual(newestFirst);

  const library = new PrismaLibraryApplication(db, settings);
  const cursors = {
    title: await library.list(
      reader,
      LibraryQuerySchema.parse({ query: tag, limit: 1 }),
    ),
    added: await library.list(
      reader,
      LibraryQuerySchema.parse({ query: tag, sort: "added", limit: 1 }),
    ),
  };
  expect(JSON.parse(cursors.title.nextCursor ?? "null")).toEqual({
    title: alpha.title,
    id: alpha.id,
  });
  expect(JSON.parse(cursors.added.nextCursor ?? "null")).toEqual({
    addedAt: recorded.episode.toISOString(),
    id: delta.id,
  });
  for (const mismatch of [
    { sort: "added", cursor: cursors.title.nextCursor },
    { sort: "title", cursor: cursors.added.nextCursor },
    { cursor: cursors.added.nextCursor },
  ])
    expect(
      LibraryQuerySchema.safeParse({ query: tag, ...mismatch }).success,
    ).toBe(false);
});

test("library filters, episode counts and leaving soon agree with what each row reports, for the reader who may see it", async () => {
  const db = harness.database();
  const tag = crypto.randomUUID();
  const { reader, housemate, owner, title, leavesAt } = await libraryHousehold(
    db,
    tag,
  );
  const { a, b, c, d, e, f, g, h, i, j, k, l, m, n } = title;
  const everything = await readLibrary(reader, { query: tag, limit: 50 });
  // H sits in a Plex library the reader may not open.
  expect(everything.ids).toEqual(ids(a, b, c, d, e, f, g, i, j, k, l, m, n));
  const shown = (id: string) => {
    const item = everything.items.find((row) => row.id === id);
    if (item === undefined) throw new Error("Title missing from the library");
    return item;
  };

  const byPolicy = {
    keep: ids(a, b, k, l, m, n),
    temporary: ids(c, d, i),
    unclassified: ids(e, f, g, j),
  };
  for (const [policy, expected] of Object.entries(byPolicy)) {
    const page = await readLibrary(reader, { query: tag, policy, limit: 50 });
    expect(page.ids, policy).toEqual(expected);
    expect(page.items.every((item) => item.policy === policy)).toBe(true);
  }
  expect(
    await libraryIds(owner, { query: tag, policy: "keep", limit: 50 }),
  ).toEqual(ids(a, b, h, k, l, m, n));

  const following = { query: tag, mine: "following", limit: 50 };
  expect(await libraryIds(reader, following)).toEqual(ids(c, i));
  expect(await libraryIds(housemate, following)).toEqual(ids(b, d));
  expect(shown(e.id).myInterest).toBe("released");

  // Leaving soon is the household's to see, whoever asked for the title.
  const leaving = { query: tag, leaving: "soon", limit: 50 };
  expect(await libraryIds(reader, leaving)).toEqual(ids(f, j));
  expect(await libraryIds(owner, leaving)).toEqual(ids(f, h, j));
  expect(shown(f.id).leavingSoon).toEqual({
    state: "grace_period",
    graceUntil: leavesAt.f.toISOString(),
  });
  // Three episodes are leaving; the series reports the first to go.
  expect(shown(j.id).leavingSoon).toEqual({
    state: "grace_period",
    graceUntil: leavesAt.j.toISOString(),
  });
  // G has already left: quarantined is not leaving soon.
  expect(shown(g.id).leavingSoon).toBeNull();
  expect(
    everything.items.filter((item) => item.leavingSoon !== null),
  ).toHaveLength(2);
  await db.retentionDecision.updateMany({
    where: {
      media: { OR: [{ parentId: j.id }, { parent: { parentId: j.id } }] },
    },
    data: { state: "warning_pending", graceUntil: null },
  });
  const waiting = await readLibrary(reader, { query: `${tag} J` });
  expect(waiting.items[0]?.leavingSoon).toEqual({
    state: "warning_pending",
    graceUntil: null,
  });

  expect(
    Object.fromEntries(
      everything.items.map((item) => [item.id, item.episodes]),
    ),
  ).toEqual({
    ...Object.fromEntries(ids(a, b, c, d, e, f, g, n).map((id) => [id, null])),
    [i.id]: { available: 1, total: 2 },
    [j.id]: { available: 3, total: 3 },
    // A special is not part of the regular run.
    [k.id]: { available: 0, total: 0 },
    [l.id]: { available: 0, total: 0 },
    // Held in an external library: unknown, not zero.
    [m.id]: null,
  });
  expect(ids(i, j, k, l, m).map((id) => shown(id).availability)).toEqual(
    Array.from({ length: 5 }, () => null),
  );

  const available = { query: tag, availability: "available" };
  const unavailable = { query: tag, availability: "unavailable" };
  expect(await libraryIds(reader, { ...available, limit: 50 })).toEqual(
    ids(a, d, e, f, i, j, m),
  );
  expect(await libraryIds(reader, { ...unavailable, limit: 50 })).toEqual(
    ids(b, c, g, k, l, n),
  );
  // One title a page: H is hidden and N's external file is unproved, so two
  // pages come back empty and still lead to the next.
  const paged = await readLibrary(reader, { ...available, limit: 1 });
  expect(paged.sizes).toEqual([1, 1, 1, 1, 0, 1, 1, 1, 0]);
  expect(paged.ids).toEqual(ids(a, d, e, f, i, j, m));
  const newest = await readLibrary(reader, {
    ...available,
    sort: "added",
    limit: 1,
  });
  expect(newest.sizes).toEqual([0, 1, 1, 1, 1, 1, 0, 1, 1]);
  expect(newest.ids).toEqual(ids(m, d, j, i, a, f, e));
  // M may be there, so it counts as available; K and L have nothing.
  const series = await readLibrary(reader, {
    ...unavailable,
    kind: "series",
    limit: 1,
  });
  expect(series.sizes).toEqual([1, 1, 0]);
});
