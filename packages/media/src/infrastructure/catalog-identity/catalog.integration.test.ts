import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { TmdbCatalogApplication } from "#infrastructure/catalog.ts";
import { CatalogIdentitySchema } from "#shared/acquisition/catalog.ts";
import { z } from "zod";
import { persistCatalogMedia } from "./persist.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { Database } from "#infrastructure/database.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { PrismaLibraryApplication } from "#infrastructure/library/views/library.ts";
import type { CatalogSearch } from "#shared/api.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { LibraryQuerySchema } from "#shared/household/library.ts";
import { externalLibraryFixture } from "#testing/external-library-fixture.ts";

const harness = automationTestHarness();
let nextId = 4000;
test("movie and series catalog namespaces retain aliases and refresh without erasing unrelated identities", async () => {
  const db = harness.database();
  const id = ++nextId;
  let alternate = "Initial alias";
  let movieImdb = "tt0004000";
  let artwork: {
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
  } = {
    overview: "First synopsis.",
    poster_path: "/first-poster.jpg",
    backdrop_path: "/first-backdrop.jpg",
  };
  const ctx = harness.context((url) => {
    if (url.pathname.endsWith("alternative_titles"))
      return Promise.resolve(
        Response.json(
          url.pathname.includes("/movie/")
            ? {
                id,
                titles: [
                  { title: alternate, iso_3166_1: "JP", type: "release" },
                ],
              }
            : {
                id,
                results: [
                  { title: alternate, iso_3166_1: "JP", type: "release" },
                ],
              },
        ),
      );
    if (url.pathname.endsWith("external_ids"))
      return Promise.resolve(
        Response.json({ id, tvdb_id: 765, imdb_id: "tt0005000" }),
      );
    const common = { id, ...artwork, original_language: "ja" };
    return Promise.resolve(
      Response.json(
        url.pathname.includes("/movie/")
          ? {
              ...common,
              title: "Movie",
              original_title: "Original movie",
              release_date: "2020-01-01",
              imdb_id: movieImdb,
              runtime: 90,
            }
          : {
              ...common,
              name: "Series",
              original_name: "Original series",
              first_air_date: "2021-01-01",
              seasons: [],
            },
      ),
    );
  });
  const app = new TmdbCatalogApplication(db, ctx.tmdb);
  const movie = await app.adopt("movie", id);
  const series = await app.adopt("series", id);
  expect(movie.mediaId).not.toBe(series.mediaId);
  const movieRow = await db.mediaItem.findUniqueOrThrow({
    where: { id: movie.mediaId },
  });
  const stored = {
    posterPath: "/first-poster.jpg",
    backdropPath: "/first-backdrop.jpg",
    overview: "First synopsis.",
    artworkObservedAt: expect.any(Date),
  };
  expect(movieRow).toMatchObject({ version: 0, ...stored });
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: series.mediaId } }),
  ).toMatchObject({ version: 0, ...stored });
  const ids = z.record(z.string(), z.json()).parse(movieRow.externalIds);
  await db.mediaItem.update({
    where: { id: movie.mediaId },
    data: {
      externalIds: { ...ids, plexSectionId: "1", ownerNote: { retain: true } },
    },
  });
  alternate = "Refreshed alias";
  await app.adopt("movie", id);
  await app.adopt("series", id);
  const refreshed = await db.mediaItem.findUniqueOrThrow({
    where: { id: movie.mediaId },
  });
  expect(refreshed).toMatchObject({
    version: 1,
    externalIds: { plexSectionId: "1", ownerNote: { retain: true } },
  });
  const movieIdentity = CatalogIdentitySchema.parse(
    z.object({ catalogIdentity: z.unknown() }).parse(refreshed.externalIds)
      .catalogIdentity,
  );
  expect(movieIdentity).toMatchObject({
    originalTitle: "Original movie",
    references: [
      { kind: "movie", namespace: "tmdb", value: String(id) },
      { kind: "movie", namespace: "imdb", value: "tt0004000" },
    ],
    aliases: [{ title: "Refreshed alias", source: "tmdb" }],
  });
  const seriesRow = await db.mediaItem.findUniqueOrThrow({
    where: { id: series.mediaId },
  });
  expect(seriesRow).toMatchObject({
    externalIds: {
      catalogIdentity: {
        references: [
          { kind: "series", namespace: "tmdb", value: String(id) },
          { kind: "series", namespace: "imdb", value: "tt0005000" },
          { kind: "series", namespace: "tvdb", value: "765" },
        ],
      },
    },
  });
  // Only the artwork changes here, and artwork is not command state: the
  // version every media command compares against must not move.
  artwork = {
    overview: "",
    poster_path: "/second-poster.jpg",
    backdrop_path: null,
  };
  await app.adopt("movie", id);
  const repainted = await db.mediaItem.findUniqueOrThrow({
    where: { id: movie.mediaId },
  });
  expect(repainted).toMatchObject({
    version: 1,
    posterPath: "/second-poster.jpg",
    backdropPath: null,
    overview: null,
  });
  expect(repainted.artworkObservedAt?.getTime()).toBeGreaterThanOrEqual(
    refreshed.artworkObservedAt?.getTime() ?? Number.NaN,
  );
  movieImdb = "tt0009999";
  await expect(app.adopt("movie", id)).rejects.toThrow(
    "conflicts with existing mapping",
  );
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: movie.mediaId } }),
  ).toMatchObject({ version: 1 });
});

const librarySettings = {
  serverMachineId: "fixture-server",
  sections: { movie: "1", series: "2" },
};

async function householdUser(
  db: Database,
  role: "owner" | "member",
  sections: string[],
) {
  const user = await db.mediaUser.create({
    data: { plexAccountId: crypto.randomUUID(), displayName: role, role },
  });
  await db.plexIdentityMapping.create({
    data: {
      userId: user.id,
      serverMachineId: librarySettings.serverMachineId,
      serverAccountId: user.plexAccountId,
      kind: "account",
      permittedSectionIds: sections,
      permittedMediaKinds: ["movie", "series"],
      verifiedAt: new Date(),
    },
  });
  return { ...user, role };
}

/** A catalog title with its default target, held in the library only by what the test adds. */
async function catalogTitle(
  db: Database,
  data: Prisma.MediaItemUncheckedCreateInput,
  hold: { keep?: boolean; requestedBy?: string[] } = {},
) {
  const media = await db.mediaItem.create({ data });
  await db.$transaction((tx) =>
    lockDefaultScopes(tx, [defaultScope(media.id)], { createMissing: true }),
  );
  if (hold.keep === true)
    await db.mediaIntent.update({
      where: targetWhere(defaultScope(media.id)),
      data: { libraryKeep: true },
    });
  for (const userId of hold.requestedBy ?? [])
    await db.mediaRequest.create({ data: { mediaId: media.id, userId } });
  return media;
}

const movieTitle = (tmdbId: number, title: string) => ({
  kind: "movie" as const,
  tmdbId,
  title: `${title} ${String(tmdbId)}`,
});
const movieWire = (media: { tmdbId: number | null; title: string }) => ({
  id: media.tmdbId,
  title: media.title,
  original_title: media.title,
  overview: "",
  release_date: "2020-01-01",
  poster_path: null,
  backdrop_path: null,
  original_language: "en",
});
const episode = (
  parentId: string,
  seasonNumber: number,
  episodeNumber: number,
  availability: "available" | "wanted",
) => ({
  kind: "episode" as const,
  title: `Episode ${String(seasonNumber)}x${String(episodeNumber)}`,
  parentId,
  seasonNumber,
  episodeNumber,
  availability,
});

/**
 * Three people and seven catalog titles: one the household never touched, one
 * only opened, an available kept movie the member once followed, a movie only
 * another member's request holds, a kept movie that member also follows, a
 * movie the owner follows in a Plex library only the owner may open, and a
 * series the member follows with two of three regular episodes available.
 */
async function householdCatalog(db: Database) {
  const owner = await householdUser(db, "owner", ["1", "2", "9"]);
  const member = await householdUser(db, "member", ["1", "2"]);
  const requester = await householdUser(db, "member", ["1", "2"]);
  const id = {
    absent: ++nextId,
    adopted: ++nextId,
    available: ++nextId,
    requested: ++nextId,
    kept: ++nextId,
    hidden: ++nextId,
    series: ++nextId,
  };
  const adopted = await catalogTitle(db, movieTitle(id.adopted, "Adopted"));
  const available = await catalogTitle(
    db,
    { ...movieTitle(id.available, "Available"), availability: "available" },
    { keep: true },
  );
  await db.mediaRequest.create({
    data: {
      mediaId: available.id,
      userId: member.id,
      active: false,
      interestState: "finished",
    },
  });
  const requested = await catalogTitle(
    db,
    { ...movieTitle(id.requested, "Requested"), availability: "downloading" },
    { requestedBy: [requester.id] },
  );
  const kept = await catalogTitle(db, movieTitle(id.kept, "Kept"), {
    keep: true,
    requestedBy: [requester.id],
  });
  const hidden = await catalogTitle(
    db,
    {
      ...movieTitle(id.hidden, "Hidden"),
      availability: "available",
      externalIds: { plexSectionId: "9" },
    },
    { keep: true, requestedBy: [owner.id] },
  );
  const series = await catalogTitle(
    db,
    { kind: "series", tmdbId: id.series, title: `Series ${String(id.series)}` },
    { requestedBy: [member.id] },
  );
  const season = await db.mediaItem.create({
    data: {
      kind: "season",
      title: "Season 1",
      parentId: series.id,
      seasonNumber: 1,
    },
  });
  await db.mediaItem.createMany({
    data: [
      episode(season.id, 1, 1, "available"),
      episode(season.id, 1, 2, "wanted"),
      // Stored without an intermediate season, as older catalog rows are.
      episode(series.id, 1, 3, "available"),
      // A special does not count towards the regular run.
      episode(series.id, 0, 1, "available"),
    ],
  });
  const seriesWire = {
    id: id.series,
    name: series.title,
    original_name: series.title,
    overview: "",
    first_air_date: "2021-01-01",
    poster_path: null,
    backdrop_path: null,
    original_language: "en",
  };
  const movies = [
    movieTitle(id.absent, "Absent"),
    adopted,
    available,
    requested,
    kept,
    hidden,
  ];
  const requests: string[] = [];
  const ctx = harness.context((url) => {
    requests.push(url.pathname);
    if (url.pathname === `/3/tv/${String(id.series)}`)
      return Promise.resolve(Response.json({ ...seriesWire, seasons: [] }));
    if (url.pathname === `/3/movie/${String(id.hidden)}`)
      return Promise.resolve(
        Response.json({ ...movieWire(hidden), imdb_id: null, runtime: 90 }),
      );
    return Promise.resolve(
      Response.json({
        page: 1,
        total_pages: 1,
        results: [
          ...movies.map((media) => ({
            ...movieWire(media),
            media_type: "movie",
          })),
          { ...seriesWire, media_type: "tv" },
        ],
      }),
    );
  });
  return {
    owner,
    member,
    requester,
    id,
    rows: { available, requested, kept, hidden, series },
    requests,
    app: new TmdbCatalogApplication(db, ctx.tmdb, librarySettings),
  };
}

function libraryStates(page: CatalogSearch) {
  return Object.fromEntries(
    page.results.map((item) => [item.externalId, item.library]),
  );
}

test("a member's search says what the household has of each title, exactly as the library lists it for them", async () => {
  const db = harness.database();
  const { app, member, id, rows } = await householdCatalog(db);
  const page = await app.search(member, "fixture", 1);
  expect(page.libraryAccess).toBe("current");
  expect(libraryStates(page)).toEqual({
    [id.absent]: null,
    // Opened once and never asked for: a row exists, but nothing holds it.
    [id.adopted]: null,
    [id.available]: {
      mediaId: rows.available.id,
      availability: "available",
      episodes: null,
      requested: false,
      myInterest: "released",
    },
    // Another member asked for these two: wanted, without saying by whom.
    [id.requested]: {
      mediaId: rows.requested.id,
      availability: "downloading",
      episodes: null,
      requested: true,
      myInterest: "none",
    },
    [id.kept]: {
      mediaId: rows.kept.id,
      availability: "wanted",
      episodes: null,
      requested: true,
      myInterest: "none",
    },
    // Kept, available and followed, but in a Plex library this member may
    // not open: nothing about it is revealed.
    [id.hidden]: null,
    [id.series]: {
      mediaId: rows.series.id,
      availability: null,
      episodes: { available: 2, total: 3 },
      requested: true,
      myInterest: "following",
    },
  });
  const library = await new PrismaLibraryApplication(db, librarySettings).list(
    member,
    LibraryQuerySchema.parse({ limit: 50 }),
  );
  const listed = Object.values(libraryStates(page)).filter(
    (state) => state !== null,
  );
  expect(listed).toHaveLength(4);
  for (const state of listed)
    expect(
      library.items.find((item) => item.id === state.mediaId),
    ).toMatchObject({
      availability: state.availability,
      myInterest: state.myInterest,
    });
  expect(library.items.some((item) => item.id === rows.hidden.id)).toBe(false);
});

test("one feed page serves the whole household while the owner and each member see their own view of it", async () => {
  const db = harness.database();
  const { app, owner, member, requester, id, rows, requests } =
    await householdCatalog(db);
  expect(
    libraryStates(await app.discover(requester, "trending", 1)),
  ).toMatchObject({
    [id.requested]: { requested: true, myInterest: "following" },
    [id.kept]: { requested: true, myInterest: "following" },
    [id.series]: { requested: true, myInterest: "none" },
    [id.hidden]: null,
  });
  // The owner may open every library; what differs is what they can see and
  // their own interest, not what the household wants.
  expect(libraryStates(await app.discover(owner, "trending", 1))).toMatchObject(
    {
      [id.absent]: null,
      [id.adopted]: null,
      [id.available]: { requested: false, myInterest: "none" },
      [id.requested]: { requested: true, myInterest: "none" },
      [id.kept]: { requested: true, myInterest: "none" },
      [id.hidden]: {
        mediaId: rows.hidden.id,
        availability: "available",
        requested: true,
        myInterest: "following",
      },
      [id.series]: { requested: true, episodes: { available: 2, total: 3 } },
    },
  );
  expect(requests).toEqual(["/3/trending/all/week"]);

  const seriesPage = await app.details(member, "series", id.series);
  expect(seriesPage).toMatchObject({
    externalId: id.series,
    libraryAccess: "current",
    library: {
      mediaId: rows.series.id,
      availability: null,
      episodes: { available: 2, total: 3 },
      requested: true,
      myInterest: "following",
    },
  });
  expect(await app.details(member, "movie", id.hidden)).toMatchObject({
    libraryAccess: "current",
    library: null,
  });
  expect(await app.details(owner, "movie", id.hidden)).toMatchObject({
    library: { mediaId: rows.hidden.id },
  });
});

test("library access that is no longer verified is reported as stale, not as an empty library", async () => {
  const db = harness.database();
  const { app, owner, member, id } = await householdCatalog(db);
  await db.plexIdentityMapping.update({
    where: { userId: member.id },
    data: { verifiedAt: new Date(Date.now() - 301_000) },
  });
  const page = await app.search(member, "fixture", 1);
  expect(page.libraryAccess).toBe("stale");
  expect(page.results).toHaveLength(7);
  expect(page.results.every((item) => item.library === null)).toBe(true);
  expect(await app.details(member, "series", id.series)).toMatchObject({
    libraryAccess: "stale",
    library: null,
  });
  // Another reader's access is their own.
  const forOwner = await app.discover(owner, "trending", 1);
  expect(forOwner.libraryAccess).toBe("current");
  expect(libraryStates(forOwner)).toMatchObject({
    [id.series]: { requested: true },
  });
  // Without Plex settings no reader's access can be confirmed at all.
  const unconfigured = await new TmdbCatalogApplication(
    db,
    harness.context(() =>
      Promise.resolve(Response.json({ page: 1, total_pages: 0, results: [] })),
    ).tmdb,
  ).search(owner, "fixture", 1);
  expect(unconfigured).toMatchObject({ libraryAccess: "stale", results: [] });
});

test("a series a registered external Plex library holds reports its episode count as unknown, not as zero", async () => {
  const db = harness.database();
  const fixture = await externalLibraryFixture(db, "episode");
  await fixture.register();
  await db.$transaction((tx) =>
    lockDefaultScopes(tx, [defaultScope(fixture.root.id)], {
      createMissing: true,
    }),
  );
  await db.mediaIntent.update({
    where: targetWhere(defaultScope(fixture.root.id)),
    data: { libraryKeep: true },
  });
  // Media's own state does not say the episode is available; Plex has the file.
  const episodeRow = await db.mediaItem.findUniqueOrThrow({
    where: { id: fixture.media.id },
  });
  expect(episodeRow.availability).not.toBe("available");
  const ctx = harness.context(() =>
    Promise.resolve(
      Response.json({
        page: 1,
        total_pages: 1,
        results: [
          {
            id: fixture.root.tmdbId,
            name: fixture.root.title,
            original_name: fixture.root.title,
            overview: "",
            first_air_date: "2024-01-01",
            poster_path: null,
            backdrop_path: null,
            original_language: "en",
            media_type: "tv",
          },
        ],
      }),
    ),
  );
  const page = await new TmdbCatalogApplication(db, ctx.tmdb, {
    serverMachineId: fixture.access.serverMachineId,
    sections: { movie: "1", series: "2" },
  }).search(fixture.owner, "external", 1);
  expect(page).toMatchObject({
    libraryAccess: "current",
    results: [
      {
        externalId: fixture.root.tmdbId,
        library: {
          mediaId: fixture.root.id,
          availability: null,
          episodes: null,
          requested: false,
          myInterest: "none",
        },
      },
    ],
  });
});

test.each([
  "wrong-kind",
  "mixed-kind",
  "wrong-tmdb",
  "stored-wrong-kind",
] as const)(
  "%s catalog references fail at persistence without replacing prior namespaces",
  async (variant) => {
    const db = harness.database();
    const id = ++nextId;
    const canonical = {
      schemaVersion: 1 as const,
      references: [
        {
          kind: "movie" as const,
          namespace: "tmdb" as const,
          value: String(id),
        },
      ],
      originalTitle: "Original",
      aliases: [],
    };
    const valid = CatalogIdentitySchema.parse({
      ...canonical,
      evidenceDigest: snapshotHash(canonical),
    });
    const changed = CatalogIdentitySchema.parse({
      ...valid,
      references:
        variant === "mixed-kind"
          ? [
              ...valid.references,
              { kind: "series", namespace: "tvdb", value: "123" },
            ]
          : [
              {
                kind: variant === "wrong-tmdb" ? "movie" : "series",
                namespace: "tmdb",
                value: String(variant === "wrong-tmdb" ? id + 1 : id),
              },
            ],
    });
    const row = await db.mediaItem.create({
      data: {
        kind: "movie",
        tmdbId: id,
        title: "Preserved",
        externalIds: {
          plexSectionId: "1",
          ...(variant === "stored-wrong-kind"
            ? { catalogIdentity: changed }
            : {}),
        },
      },
    });
    await expect(
      db.$transaction(
        (tx) =>
          persistCatalogMedia(tx, {
            kind: "movie",
            tmdbId: id,
            title: "New title",
            year: 2020,
            originalLanguage: "en",
            runtimeMinutes: 90,
            identity: variant === "stored-wrong-kind" ? valid : changed,
            artwork: { posterPath: null, backdropPath: null, overview: null },
          }),
        { isolationLevel: "Serializable" },
      ),
    ).rejects.toThrow("namespace conflicts");
    expect(
      await db.mediaItem.findUniqueOrThrow({ where: { id: row.id } }),
    ).toEqual(row);
  },
);
