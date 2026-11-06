import { expect, test } from "vitest";
import type { CoordinateSnapshot } from "#shared/acquisition/coordinates.ts";
import { SeriesSeasonSetV1Schema } from "#shared/acquisition/series-pack-v1.ts";
import {
  parseSeriesSeasonSetV1,
  resolveSeriesSeasonSetV1,
} from "./series-season-set.ts";
import { matchSeriesPackReleaseV1 } from "./series-pack-matcher.ts";
import { matchRelease } from "#domain/release-parser.ts";

function catalog(count: number): CoordinateSnapshot {
  const seriesId = crypto.randomUUID();
  return {
    schemaVersion: 1,
    seriesId,
    seriesVersion: 1,
    catalogComplete: true,
    fullSeriesNumberingDigest: "a".repeat(64),
    digest: "b".repeat(64),
    episodes: [1, 2].flatMap((seasonNumber) =>
      Array.from({ length: count }, (_, index) => ({
        mediaId: crypto.randomUUID(),
        mediaVersion: 1,
        seriesId,
        seasonNumber,
        episodeNumber: index + 1,
        tmdbEpisodeId: null,
        absoluteNumber: null,
        numberingProvenance: { kind: "canonical" as const },
      })),
    ),
  };
}

test.each(["S01-S02", "s1 - s2", "S001._-_.S002"])(
  "one literal %s denotes its complete explicit season set",
  (token) => {
    const parsed = parseSeriesSeasonSetV1(
      `Synthetic.Anime.2020.${token}.1080p.WEB-DL.H264.English-MEDIA`,
    );
    expect(parsed).toEqual({
      status: "resolved",
      range: {
        schemaVersion: 1,
        kind: "explicit_season_range",
        raw: token,
        start: 1,
        end: 2,
        seasons: [1, 2],
      },
    });
    if (parsed.status !== "resolved")
      throw new Error("Positive parser case protected");
    expect(SeriesSeasonSetV1Schema.parse(parsed.range)).toEqual(parsed.range);
  },
);

test.each([
  ["S01", "not_applicable"],
  ["S01.S02", "not_applicable"],
  ["Season.1.Season.2", "not_applicable"],
  ["S00-S01", "season_set_invalid"],
  ["S02-S01", "season_set_invalid"],
  ["S01-S01", "season_set_invalid"],
  ["S01-S101", "coverage_limit"],
  ["S01-S02.S03", "season_set_conflict"],
  ["S01-S02.S01E01", "season_set_conflict"],
  ["1d73ee08-e471-4bb9-a56c-b4837de660a0.S01-S02", "season_set_conflict"],
  ["S01-S02.1x01", "season_set_conflict"],
  ["S01-S02.E01", "season_set_conflict"],
  ["S01-S02.S03-S04", "season_set_invalid"],
])(
  "independent or conflicting %s cannot become a guessed union",
  (token, reason) => {
    const parsed = parseSeriesSeasonSetV1(
      `Synthetic.Anime.${token}.1080p.WEB-DL`,
    );
    expect(reason === "not_applicable" ? parsed.status : parsed).toEqual(
      reason === "not_applicable" ? reason : { status: "protected", reason },
    );
  },
);

test("the strict raw protocol rejects a forged token or missing intermediate season", () => {
  const range = {
    schemaVersion: 1,
    kind: "explicit_season_range",
    raw: "S01-S02",
    start: 1,
    end: 2,
    seasons: [1, 2],
  };
  expect(SeriesSeasonSetV1Schema.safeParse(range).success).toBe(true);
  for (const attack of [
    { ...range, raw: "S03-S04" },
    { ...range, raw: "prefix.S01-S02" },
    { ...range, raw: "S01-S03", end: 3, seasons: [1, 3] },
    { ...range, seasons: [2, 1] },
    { ...range, seasons: [1, 1] },
  ])
    expect(SeriesSeasonSetV1Schema.safeParse(attack).success).toBe(false);
});

test.each([2, 12])(
  "two whole seasons each containing %i episodes retain every leaf",
  (count) => {
    const snapshot = catalog(count);
    const parsed = parseSeriesSeasonSetV1(
      "Synthetic.Anime.2020.S01-S02.1080p.WEB-DL.H264.English-MEDIA",
    );
    if (parsed.status !== "resolved")
      throw new Error("Explicit range fixture is invalid");
    expect(resolveSeriesSeasonSetV1(parsed.range, snapshot)).toEqual({
      status: "resolved",
      mediaIds: snapshot.episodes.map((leaf) => leaf.mediaId).sort(),
    });
    expect(
      resolveSeriesSeasonSetV1(parsed.range, {
        ...snapshot,
        episodes: snapshot.episodes.filter((leaf) => leaf.seasonNumber === 1),
      }),
    ).toEqual({ status: "protected", reason: "season_set_incomplete" });
    const first = snapshot.episodes[0];
    if (first === undefined)
      throw new Error("Positive whole catalog has no first leaf");
    expect(
      resolveSeriesSeasonSetV1(parsed.range, {
        ...snapshot,
        episodes: [...snapshot.episodes, first],
      }),
    ).toEqual({ status: "protected", reason: "season_set_conflict" });
  },
);

test("the additive matcher preserves literal old interpretation and rejects manualMapping as pack permission", () => {
  const snapshot = catalog(12);
  const first = snapshot.episodes[0];
  if (first === undefined)
    throw new Error("Positive whole catalog has no first leaf");
  const input = {
    id: crypto.randomUUID(),
    providerId: "knaben",
    title: "Synthetic.Anime.2020.S01-S02.1080p.WEB-DL.H264.English-MEDIA",
    sizeBytes: 1_000_000,
    media: {
      id: first.mediaId,
      kind: "episode" as const,
      title: "Episode 1",
      year: null,
      seriesTitle: "Synthetic Anime",
      seriesYear: 2020,
    },
    knownEpisodes: snapshot.episodes.map((leaf) => ({
      mediaId: leaf.mediaId,
      season: leaf.seasonNumber,
      episode: leaf.episodeNumber,
    })),
  };
  const legacy = matchRelease(input);
  expect(legacy.attributes.identityConfidence).not.toBe("exact");
  const derived = matchSeriesPackReleaseV1(input, snapshot);
  expect(derived).toMatchObject({
    status: "resolved",
    attributes: {
      identityConfidence: "exact",
      mediaIds: snapshot.episodes.map((leaf) => leaf.mediaId).sort(),
    },
  });
  expect(matchRelease(input)).toEqual(legacy);
  expect(
    matchSeriesPackReleaseV1(
      {
        ...input,
        title: input.title.replace("Synthetic.Anime", "Different.Show"),
        manualMapping: {
          releaseTitle: input.title,
          mediaIds: snapshot.episodes.map((leaf) => leaf.mediaId),
        },
      },
      snapshot,
    ),
  ).toMatchObject({
    status: "resolved",
    attributes: { identityConfidence: "mismatch" },
  });
});
