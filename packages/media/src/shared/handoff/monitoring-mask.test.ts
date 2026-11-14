import { expect, test } from "vitest";
import {
  libraryEpisodeMonitored,
  LibraryMonitoringMaskSchema,
} from "./monitoring-mask.ts";

test("captured season and episode masks survive future catalog expansion", () => {
  const policy = {
    includeSpecials: false,
    monitoringMask: {
      seasons: [
        { season: 1, monitored: false },
        { season: 0, monitored: false },
      ],
      episodes: [
        { season: 1, episode: 2, monitored: true },
        { season: 2, episode: 3, monitored: false },
      ],
    },
  };
  expect(libraryEpisodeMonitored(policy, 1, 1)).toBe(false);
  expect(libraryEpisodeMonitored(policy, 1, 2)).toBe(true);
  expect(libraryEpisodeMonitored(policy, 1, 99)).toBe(false);
  expect(libraryEpisodeMonitored(policy, 2, 3)).toBe(false);
  expect(libraryEpisodeMonitored(policy, 2, 99)).toBe(true);
  expect(libraryEpisodeMonitored(policy, 0, 1)).toBe(false);
});
test("historical policies retain their literal specials behavior; duplicate masks fail", () => {
  expect(libraryEpisodeMonitored({ includeSpecials: true }, 0, 1)).toBe(true);
  expect(libraryEpisodeMonitored({ includeSpecials: false }, 0, 1)).toBe(false);
  expect(() =>
    LibraryMonitoringMaskSchema.parse({
      seasons: [
        { season: 1, monitored: true },
        { season: 1, monitored: false },
      ],
      episodes: [],
    }),
  ).toThrow();
});
