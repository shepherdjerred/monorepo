import { expect, test } from "vitest";
import type { CoordinateSnapshot } from "#shared/acquisition/coordinates.ts";
import { resolveTvMemberCoordinates } from "./tv-member.ts";

const seriesId = "23b6b2c5-bc0e-416b-93a1-6a371873a2bf";
const first = "7bd96606-ed73-42cf-9f01-4b2cc69cfb48";
const second = "b968dd8a-8ab9-46e8-88cc-128ca4cc467a";
const snapshot: CoordinateSnapshot = {
  schemaVersion: 1,
  seriesId,
  seriesVersion: 2,
  catalogComplete: true,
  fullSeriesNumberingDigest: "a".repeat(64),
  digest: "b".repeat(64),
  episodes: [first, second].map((mediaId, index) => ({
    mediaId,
    mediaVersion: 1,
    seriesId,
    seasonNumber: 1,
    episodeNumber: index + 1,
    tmdbEpisodeId: index + 100,
    absoluteNumber: index + 13,
    numberingProvenance: { kind: "canonical" },
  })),
};

test.each(["Season 01/01.mkv", "Season01/E01.mkv", "Show/S01/e0001.mp4"])(
  "%s resolves one leaf using an explicit immediate season directory",
  (name) => {
    const resolved = resolveTvMemberCoordinates(name, snapshot);
    expect(resolved).toMatchObject({
      status: "resolved",
      mediaIds: [first],
      parsed: {
        forms: [
          { kind: "season_episodes", season: 1, episodes: [1], form: "single" },
        ],
        invalid: false,
      },
      directory: { season: 1, episode: 1 },
    });
  },
);

test.each([
  ["Show/01.mkv", "coordinate_unknown"],
  ["Season 01/Part/01.mkv", "coordinate_unknown"],
  ["Season 01/Clip01.mkv", "coordinate_unknown"],
  ["Season 01/01-02.mkv", "coordinate_unknown"],
  ["Season 00/01.mkv", "coordinate_unknown"],
  ["Specials/E01.mkv", "coordinate_unknown"],
  ["Season 01/E00.mkv", "coordinate_invalid"],
  ["Season 01/03.mkv", "coordinate_unmapped"],
  ["Season 01/S02E01.mkv", "coordinate_unmapped"],
  ["Season 02/Show.S01E01.mkv", "coordinate_conflict"],
  ["Season 02/Show - 013.mkv", "coordinate_conflict"],
  ["S01/Season 01/01.mkv", "coordinate_conflict"],
  ["S01/Season 02/01.mkv", "coordinate_conflict"],
  ["../Season 01/01.mkv", "coordinate_invalid"],
  ["/Season 01/01.mkv", "coordinate_invalid"],
  ["Season 01//01.mkv", "coordinate_invalid"],
  ["Season 01/./01.mkv", "coordinate_invalid"],
  [String.raw`Season 01\01.mkv`, "coordinate_invalid"],
  ["nested/".repeat(31) + "Season 01/01.mkv", "coordinate_invalid"],
])("%s stays protected with %s", (name, reason) => {
  expect(resolveTvMemberCoordinates(name, snapshot)).toEqual({
    status: "protected",
    reason,
  });
});

test("explicit filename coordinates must agree with directory evidence even when both seasons exist", () => {
  const original = snapshot.episodes[0];
  if (original === undefined)
    throw new Error("Missing original test coordinate");
  const other = {
    ...original,
    mediaId: crypto.randomUUID(),
    seasonNumber: 2,
  };
  const current = { ...snapshot, episodes: [...snapshot.episodes, other] };
  expect(resolveTvMemberCoordinates("Season 01/S02E01.mkv", current)).toEqual({
    status: "protected",
    reason: "coordinate_conflict",
  });
});

test("full canonical filenames and reviewed absolute numbering retain their existing coordinate interpretation", () => {
  for (const name of ["Season 01/Show.S01E01.mkv", "Season 01/Show - 013.mkv"])
    expect(resolveTvMemberCoordinates(name, snapshot)).toMatchObject({
      status: "resolved",
      mediaIds: [first],
      directory: null,
    });
  const original = snapshot.episodes[0];
  if (original === undefined)
    throw new Error("Missing original test coordinate");
  const special = { ...original, seasonNumber: 0 };
  expect(
    resolveTvMemberCoordinates("Season 00/Show.S00E01.mkv", {
      ...snapshot,
      episodes: [special],
    }),
  ).toMatchObject({ status: "resolved", mediaIds: [first], directory: null });
});
