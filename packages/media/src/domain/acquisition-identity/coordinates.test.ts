import { expect, test } from "vitest";
import type { CoordinateSnapshot } from "#shared/acquisition/coordinates.ts";
import { parseEpisodeCoordinates } from "./parser.ts";
import { resolveEpisodeCoordinates } from "./coordinates.ts";

const seriesId = crypto.randomUUID();
const episodeIds = [crypto.randomUUID(), crypto.randomUUID()];
const snapshot: CoordinateSnapshot = {
  schemaVersion: 1,
  seriesId,
  seriesVersion: 1,
  catalogComplete: true,
  fullSeriesNumberingDigest: "a".repeat(64),
  digest: "b".repeat(64),
  episodes: episodeIds.map((mediaId, index) => ({
    mediaId,
    mediaVersion: 1,
    seriesId,
    seasonNumber: 2,
    episodeNumber: index + 1,
    tmdbEpisodeId: 100 + index,
    absoluteNumber: index + 13,
    numberingProvenance: {
      kind: "legacy_owner",
      version: 1,
      evidence: "Reviewed canonical numbering",
    },
  })),
};
const resolve = (title: string) =>
  resolveEpisodeCoordinates(parseEpisodeCoordinates(title), snapshot);

test("absolute release and actual multi-episode filename resolve to the same canonical leaves", () => {
  expect(
    resolve("[Group] Coastlines - 013-014 (1080p) [ABCDEF12].mkv"),
  ).toEqual({ status: "resolved", mediaIds: episodeIds });
  expect(resolve("Coastlines.S02E01-E02.WEB-DL.1080p.mkv")).toEqual({
    status: "resolved",
    mediaIds: episodeIds,
  });
  expect(resolve("Coastlines.2x01-02.mkv")).toEqual({
    status: "resolved",
    mediaIds: episodeIds,
  });
});
test("all coordinate forms must agree, including second season tokens", () => {
  expect(resolve("Coastlines.S02E01 ( - 014 ) (1080p).mkv")).toEqual({
    status: "protected",
    reason: "coordinate_conflict",
  });
  expect(resolve("Coastlines.S02E01 ( - 013 ) (1080p).mkv")).toEqual({
    status: "resolved",
    mediaIds: [episodeIds[0]],
  });
  expect(resolve("Coastlines.S02E01.S02E02.mkv")).toEqual({
    status: "protected",
    reason: "coordinate_conflict",
  });
});
test("duplicates, absent mappings and invalid ranges never become partial coverage", () => {
  expect(resolve("Coastlines - 012-014.mkv")).toEqual({
    status: "protected",
    reason: "coordinate_unmapped",
  });
  expect(resolve("Coastlines.S02E01-E9999.mkv")).toEqual({
    status: "protected",
    reason: "coordinate_invalid",
  });
  expect(resolve("Coastlines - 014-013.mkv")).toEqual({
    status: "protected",
    reason: "coordinate_invalid",
  });
  expect(
    resolveEpisodeCoordinates(parseEpisodeCoordinates("Coastlines - 013.mkv"), {
      ...snapshot,
      episodes: snapshot.episodes.map((episode) => ({
        ...episode,
        absoluteNumber: 13,
      })),
    }),
  ).toEqual({ status: "protected", reason: "coordinate_duplicate" });
});
test("packs and lists retain exact coverage while unknown names stay protected", () => {
  expect(resolve("Coastlines.S02.1080p.WEB-DL.mkv")).toEqual({
    status: "resolved",
    mediaIds: episodeIds,
  });
  expect(resolve("Coastlines.S02E01E02.mkv")).toEqual({
    status: "resolved",
    mediaIds: episodeIds,
  });
  expect(resolve("Coastlines - 013+014.mkv")).toEqual({
    status: "resolved",
    mediaIds: episodeIds,
  });
  expect(resolve("Coastlines.1080p.mkv")).toEqual({
    status: "protected",
    reason: "coordinate_unknown",
  });
  expect(parseEpisodeCoordinates("x".repeat(4097))).toEqual({
    forms: [],
    invalid: true,
  });
});
