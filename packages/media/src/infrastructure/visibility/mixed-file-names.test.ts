import { expect, test } from "vitest";
import { fileCoverage } from "#automation/files/inspection.ts";
import { mixedVisibilityFileNames } from "./mixed.test-support.ts";

const attempts = [
  "e1000000-0000-4000-8000-000000000000",
  "a1000000-0000-4000-8000-000000000000",
];
const media = [1, 2, 3].map((episodeNumber) => ({
  id: `episode-${String(episodeNumber)}`,
  kind: "episode",
  title: "Coastlines",
  seasonNumber: 1,
  episodeNumber,
  year: 2026,
}));

test.each(attempts)(
  "mixed fixture keeps exact three-leaf/two-file coverage for attempt %s",
  (attemptId) => {
    const names = mixedVisibilityFileNames(attemptId);
    expect(names.map((name) => fileCoverage(name, media))).toEqual([
      ["episode-1", "episode-2"],
      ["episode-3"],
    ]);
  },
);

test("mixed fixture filenames remain unique across attempts", () => {
  expect(
    new Set(
      attempts.flatMap((attemptId) => mixedVisibilityFileNames(attemptId)),
    ).size,
  ).toBe(4);
});
