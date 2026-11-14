import { expect, test } from "vitest";
import { capturedSeriesMask } from "./captured-monitoring.ts";
import { mediaFixture } from "#migration/bundle-test-fixtures.ts";

test("series masks retain only their exact source ancestry and every explicit monitoring override", () => {
  const root = mediaFixture("series:1", "series", { tvdb: 42 });
  const season = {
    ...root,
    sourceId: "season:1:1",
    mediaKind: "season" as const,
    parentSourceId: root.sourceId,
    season: 1,
    monitored: false,
  };
  const episode = {
    ...root,
    sourceId: "episode:3",
    mediaKind: "episode" as const,
    parentSourceId: root.sourceId,
    season: 1,
    episode: 3,
    monitored: true,
  };
  expect(
    capturedSeriesMask(
      [
        root,
        season,
        episode,
        { ...season, sourceId: "other", parentSourceId: "series:2", season: 2 },
      ],
      root.sourceId,
    ),
  ).toEqual({
    seasons: [{ season: 1, monitored: false }],
    episodes: [{ season: 1, episode: 3, monitored: true }],
  });
  expect(() => capturedSeriesMask([root, episode], root.sourceId)).toThrow(
    "Recapture Sonarr season masks",
  );
  expect(() =>
    capturedSeriesMask(
      [
        root,
        season,
        episode,
        { ...episode, sourceId: "different-id-same-coordinate" },
      ],
      root.sourceId,
    ),
  ).toThrow();
});
