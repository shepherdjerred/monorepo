import { expect, test } from "vitest";
import { AvailabilitySchema } from "#shared/contract.ts";
import { AVAILABILITY_COPY } from "./availability.ts";
import { KEEPING_COPY, PROTECTION_COPY } from "./keeping.ts";
import { kindAndYear, libraryStatePhrase } from "./state-phrase.ts";

const film = {
  availability: "available",
  episodes: null,
  leavingSoon: null,
} as const;

test("a film says where it is on its way in", () => {
  expect(libraryStatePhrase(film)).toEqual({
    label: "Ready to watch",
    tone: "ok",
  });
  expect(
    libraryStatePhrase({ ...film, availability: "downloading" }).label,
  ).toBe("On the way");
  expect(libraryStatePhrase({ ...film, availability: "wanted" }).label).toBe(
    "Not found yet",
  );
});

test("a series says how much of it can be played", () => {
  const series = { availability: null, leavingSoon: null };
  expect(
    libraryStatePhrase({ ...series, episodes: { available: 3, total: 10 } }),
  ).toEqual({ label: "3 of 10 episodes", tone: "progress" });
  expect(
    libraryStatePhrase({ ...series, episodes: { available: 10, total: 10 } })
      .label,
  ).toBe("Ready to watch");
  expect(
    libraryStatePhrase({ ...series, episodes: { available: 0, total: 8 } })
      .label,
  ).toBe("No episodes yet");
  // No count: a Plex library outside Media holds it.
  expect(libraryStatePhrase({ ...series, episodes: null }).label).toBe(
    "Ready to watch",
  );
});

test("a removal the household can still stop outranks everything else", () => {
  expect(
    libraryStatePhrase(
      {
        availability: "available",
        episodes: null,
        leavingSoon: {
          state: "grace_period",
          graceUntil: "2026-11-24T12:00:00.000Z",
        },
      },
      "en-US",
    ),
  ).toEqual({ label: "Leaving Nov 24", tone: "warn" });
  expect(
    libraryStatePhrase({
      availability: null,
      episodes: { available: 4, total: 4 },
      leavingSoon: { state: "warning_pending", graceUntil: null },
    }).label,
  ).toBe("Leaving soon");
});

test("a title's detail line names its kind and, when known, its year", () => {
  expect(kindAndYear("movie", 2024)).toBe("Film, 2024");
  expect(kindAndYear("series", null)).toBe("Series");
});

test("no member-facing phrase is a raw enum name or system vocabulary", () => {
  const phrases = [
    ...Object.values(AVAILABILITY_COPY).map((copy) => copy.label),
    ...Object.values(KEEPING_COPY),
    ...Object.values(PROTECTION_COPY),
  ];
  const system = [
    ...AvailabilitySchema.options.filter((name) => name !== "removed"),
    "policy",
    "unclassified",
    "review",
    "reconcil",
    "temporary",
    "indefinitely",
    "_",
  ];
  for (const phrase of phrases) {
    for (const word of system) {
      expect(phrase.toLowerCase(), phrase).not.toContain(word);
    }
  }
});
