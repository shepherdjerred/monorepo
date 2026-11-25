import { expect, test } from "vitest";
import {
  LegacyActivityEventSchema,
  LegacyActivityImportSchema,
  legacyActivityKey,
} from "./contract.ts";

const bazarr = {
  source: "bazarr",
  sourceInstanceId: "87f50ca7-ac69-48be-8380-7ae6bcea04a5",
  table: "episode",
  originalId: 150,
  sourceDate: "2026-09-27T03:02:58.123456Z",
  action: 1,
  mediaId: 31,
  seriesId: 11,
  provider: "Example Subtitles",
  language: "en:forced",
  score: 100,
  scoreOutOf: 100,
  upgradedFromId: null,
} as const;

test("activity accepts historical provenance and refuses private URLs and fields", () => {
  const batch = { kind: "legacy_activity", events: [bazarr] };
  expect(LegacyActivityImportSchema.parse(batch)).toEqual(batch);
  for (const row of [
    { ...bazarr, apiKey: "fixture-secret" },
    {
      ...bazarr,
      provider: "https://example.invalid/torrent?passkey=fixture-secret",
    },
    { ...bazarr, provider: "83d68e6cb4fce72bc142d1d539194da4" },
    { ...bazarr, sourceDate: "invalid-date" },
    { ...bazarr, path: "/private/file" },
  ]) {
    expect(LegacyActivityEventSchema.safeParse(row).success).toBe(false);
  }
});

test("different source instances and Bazarr tables keep independent row IDs", () => {
  const episode = LegacyActivityEventSchema.parse(bazarr);
  const movie = LegacyActivityEventSchema.parse({ ...bazarr, table: "movie" });
  const otherInstance = LegacyActivityEventSchema.parse({
    ...bazarr,
    sourceInstanceId: "9fb8d288-6de6-4a25-8891-949b7be9641b",
  });
  expect(
    new Set(
      [episode, movie, otherInstance].map((event) => legacyActivityKey(event)),
    ).size,
  ).toBe(3);
});
