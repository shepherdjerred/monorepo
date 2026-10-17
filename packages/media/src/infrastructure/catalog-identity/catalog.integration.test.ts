import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { TmdbCatalogApplication } from "#infrastructure/catalog.ts";
import { CatalogIdentitySchema } from "#shared/acquisition/catalog.ts";
import { z } from "zod";
import { persistCatalogMedia } from "./persist.ts";
import { snapshotHash } from "#migration/profile-import.ts";

const harness = automationTestHarness();
let nextId = 4000;
test("movie and series catalog namespaces retain aliases and refresh without erasing unrelated identities", async () => {
  const db = harness.database();
  const id = ++nextId;
  let alternate = "Initial alias";
  let movieImdb = "tt0004000";
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
    const common = {
      id,
      overview: "",
      poster_path: null,
      original_language: "ja",
    };
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
  await app.adopt("movie", id);
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: movie.mediaId } }),
  ).toMatchObject({ version: 1 });
  movieImdb = "tt0009999";
  await expect(app.adopt("movie", id)).rejects.toThrow(
    "conflicts with existing mapping",
  );
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: movie.mediaId } }),
  ).toMatchObject({ version: 1 });
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
          }),
        { isolationLevel: "Serializable" },
      ),
    ).rejects.toThrow("namespace conflicts");
    expect(
      await db.mediaItem.findUniqueOrThrow({ where: { id: row.id } }),
    ).toEqual(row);
  },
);
