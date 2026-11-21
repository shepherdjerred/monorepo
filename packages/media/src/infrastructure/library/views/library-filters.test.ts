import { expect, test } from "vitest";
import { LibraryQuerySchema } from "#shared/household/library.ts";
import {
  libraryAvailabilityMatches,
  libraryWhere,
} from "#infrastructure/library/views/library-filters.ts";

const movie = (availability: string) => ({
  kind: "movie" as const,
  availability,
  episodes: null,
});
const series = (episodes: { available: number; total: number } | null) => ({
  kind: "series" as const,
  availability: null,
  episodes,
});

test("every title is either available or unavailable, never both and never neither", () => {
  const titles = [
    { item: movie("available"), available: true },
    { item: movie("downloading"), available: false },
    { item: movie("quarantined"), available: false },
    { item: series({ available: 3, total: 10 }), available: true },
    { item: series({ available: 0, total: 10 }), available: false },
    // No episodes known yet.
    { item: series({ available: 0, total: 0 }), available: false },
    // Held in an external library: the count is unknown, the title may play.
    { item: series(null), available: true },
  ];
  for (const { item, available } of titles) {
    expect(libraryAvailabilityMatches("all", item)).toBe(true);
    expect(libraryAvailabilityMatches("available", item)).toBe(available);
    expect(libraryAvailabilityMatches("unavailable", item)).toBe(!available);
  }
});

function conditions(query: Record<string, string>): number {
  const where = libraryWhere(LibraryQuerySchema.parse(query), "actor");
  if (!Array.isArray(where.AND)) throw new TypeError("Expected a conjunction");
  return where.AND.filter((condition) => Object.keys(condition).length > 0)
    .length;
}

test("a filter left at all adds no condition, and each chosen filter adds exactly one", () => {
  // Kind and library membership always apply.
  expect(conditions({})).toBe(2);
  expect(conditions({ query: "dune" })).toBe(3);
  for (const filter of [
    { policy: "keep" },
    { policy: "temporary" },
    { policy: "unclassified" },
    { mine: "following" },
    { leaving: "soon" },
    { availability: "available" },
    { availability: "unavailable" },
  ])
    expect(conditions(filter), JSON.stringify(filter)).toBe(3);
  expect(
    conditions({
      policy: "temporary",
      mine: "following",
      leaving: "soon",
      availability: "available",
    }),
  ).toBe(6);
});
