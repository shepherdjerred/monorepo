import { expect, test } from "vitest";
import type { CatalogLibraryState } from "#shared/catalog/contract.ts";
import { AvailabilitySchema } from "#shared/contract.ts";
import { AVAILABILITY_COPY } from "#client/presentation/availability.ts";
import { FEED_COPY } from "#client/presentation/catalog.ts";
import {
  householdState,
  localDay,
  releaseDetail,
  titleAddress,
  uniqueEntries,
  type CatalogItem,
} from "./card.ts";

const film: CatalogLibraryState = {
  mediaId: "00000002-0000-4000-8000-000000000001",
  availability: "available",
  episodes: null,
  requested: false,
  myInterest: "none",
};
const series: CatalogLibraryState = {
  ...film,
  availability: null,
  episodes: { available: 3, total: 10 },
};

function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    externalId: 603,
    kind: "movie",
    title: "The Matrix",
    overview: "",
    date: "1999-03-31",
    posterPath: null,
    backdropPath: null,
    originalLanguage: "en",
    library: null,
    ...overrides,
  };
}

test("a title the household does not have invites a request", () => {
  expect(householdState(null, "current")).toEqual({
    state: { label: "Request", tone: "neutral" },
    invites: true,
    note: null,
  });
});

test("a title nobody could check says nothing, least of all that it is missing", () => {
  expect(householdState(null, "stale")).toEqual({
    state: null,
    invites: false,
    note: null,
  });
});

test("a film says where it stands, in the library's words", () => {
  expect(householdState(film, "current")).toMatchObject({
    state: { label: "Ready to watch", tone: "ok" },
    invites: false,
  });
  expect(
    householdState({ ...film, availability: "downloading" }, "current").state,
  ).toEqual({ label: "On the way", tone: "progress" });
  expect(
    householdState({ ...film, availability: "wanted" }, "current").state?.label,
  ).toBe("Not found yet");
  // Every availability reads as it does in the Library, and none is the offer.
  for (const availability of AvailabilitySchema.options) {
    expect(
      householdState({ ...film, availability }, "current"),
      availability,
    ).toEqual({
      state: AVAILABILITY_COPY[availability],
      invites: false,
      note: null,
    });
  }
});

test("a series says how much of it can be played", () => {
  expect(householdState(series, "current").state).toEqual({
    label: "3 of 10 episodes",
    tone: "progress",
  });
  expect(
    householdState(
      { ...series, episodes: { available: 10, total: 10 } },
      "current",
    ).state?.label,
  ).toBe("Ready to watch");
  expect(
    householdState(
      { ...series, episodes: { available: 0, total: 8 } },
      "current",
    ).state?.label,
  ).toBe("No episodes yet");
});

test("a series with no count is in the library, not empty and not complete", () => {
  expect(
    householdState({ ...series, episodes: null }, "current").state,
  ).toEqual({ label: "In the library", tone: "ok" });
});

function note(state: Partial<CatalogLibraryState>): string | null {
  return householdState({ ...film, ...state }, "current").note;
}

test("the note says who wants the title: the reader first, then anyone else", () => {
  expect(note({ myInterest: "following", requested: true })).toBe(
    "You follow this",
  );
  expect(note({ myInterest: "none", requested: true })).toBe(
    "Others follow this",
  );
  expect(note({ myInterest: "released", requested: true })).toBe(
    "Others follow this",
  );
  expect(note({ myInterest: "released", requested: false })).toBeNull();
  expect(note({ myInterest: "none", requested: false })).toBeNull();
});

test("a card leads to the household's page for a title it has, else the catalog's", () => {
  expect(titleAddress(item())).toBe("/catalog/movie/603");
  expect(titleAddress(item({ kind: "series", externalId: 1396 }))).toBe(
    "/catalog/series/1396",
  );
  expect(titleAddress(item({ library: film }))).toBe(
    "/media/00000002-0000-4000-8000-000000000001",
  );
});

test("the detail line gives the year, or the day a title arrives", () => {
  const today = "2026-11-21";
  expect(releaseDetail(item(), today, "en-US")).toBe("Film, 1999");
  expect(
    releaseDetail(item({ kind: "series", date: "2026-11-20" }), today, "en-US"),
  ).toBe("Series, 2026");
  // Not out yet, today included: the day, as TMDB wrote it, in no time zone.
  expect(releaseDetail(item({ date: today }), today, "en-US")).toBe(
    "Film, Nov 21",
  );
  expect(releaseDetail(item({ date: "2027-01-01" }), today, "en-US")).toBe(
    "Film, Jan 1",
  );
  // TMDB has no date for a title with no release announced.
  expect(releaseDetail(item({ kind: "series", date: "" }), today)).toBe(
    "Series",
  );
});

test("today is the reader's calendar day, in the form TMDB writes dates", () => {
  expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  expect(localDay(new Date(2026, 10, 21, 0, 0))).toBe("2026-11-21");
});

test("a title a feed lists twice is shown once; a film and a series can share a number", () => {
  const entries = [
    item({ title: "First" }),
    item({ title: "Again" }),
    item({ kind: "series", title: "Series" }),
    item({ externalId: 604, title: "Other" }),
  ].map((entry) => ({ item: entry, access: "current" as const }));
  expect(uniqueEntries(entries).map(({ entry }) => entry.item.title)).toEqual([
    "First",
    "Series",
    "Other",
  ]);
  expect(uniqueEntries(entries).map(({ key }) => key)).toEqual([
    "movie-603",
    "series-603",
    "movie-604",
  ]);
});

test("no feed is named by its contract value", () => {
  for (const [feed, copy] of Object.entries(FEED_COPY)) {
    expect(copy.title, feed).not.toMatch(/_|movie/iu);
    expect(copy.about, feed).not.toMatch(/_|movie|tmdb/iu);
  }
});
