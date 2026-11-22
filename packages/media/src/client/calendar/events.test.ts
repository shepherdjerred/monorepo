import { afterAll, describe, expect, test } from "vitest";
import {
  CalendarEventSchema,
  type CalendarEvent,
} from "#shared/household/calendar.ts";
import {
  releaseCount,
  releaseDays,
  releaseDetail,
  releaseShortDetail,
  releaseTitle,
  squareReleases,
} from "./events.ts";

function release(overrides: Partial<CalendarEvent> & { id: string }) {
  return CalendarEventSchema.parse({
    mediaId: `media-${overrides.id}`,
    rootMediaId: `root-${overrides.id}`,
    artwork: { posterPath: null, backdropPath: null },
    title: "Anora",
    seriesTitle: null,
    seasonNumber: null,
    episodeNumber: null,
    kind: "digital",
    region: "US",
    date: "2026-11-01",
    precision: "day",
    availability: "wanted",
    observedAt: null,
    ...overrides,
  });
}

function episode(
  id: string,
  series: string,
  [season, number]: readonly [season: number, episode: number],
  date: string,
) {
  return release({
    id,
    title: `Episode ${String(number)}`,
    seriesTitle: series,
    seasonNumber: season,
    episodeNumber: number,
    kind: "episode",
    region: null,
    date,
  });
}

const startingZone = Bun.env.TZ;

afterAll(() => {
  if (startingZone === undefined) delete Bun.env.TZ;
  else Bun.env.TZ = startingZone;
});

describe.each([
  "UTC",
  "America/Los_Angeles",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
])("with the viewer's clock in %s", (zone) => {
  test("each release lands on the date it was sent with, whatever the zone", () => {
    Bun.env.TZ = zone;
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
    const { days, undated } = releaseDays([
      // The first and last days of a month, a clock change, and a leap day.
      release({ id: "a", date: "2026-11-01" }),
      release({ id: "b", date: "2026-10-31" }),
      release({ id: "c", date: "2026-03-08" }),
      release({ id: "d", date: "2028-02-29" }),
      release({ id: "e", date: "2026-12-31" }),
      release({ id: "f", date: "2027-01-01" }),
    ]);
    expect(undated).toEqual([]);
    expect(
      [...days].map(([date, events]) => [date, events.map((e) => e.id)]),
    ).toEqual([
      ["2026-11-01", ["a"]],
      ["2026-10-31", ["b"]],
      ["2026-03-08", ["c"]],
      ["2028-02-29", ["d"]],
      ["2026-12-31", ["e"]],
      ["2027-01-01", ["f"]],
    ]);
  });
});

test("releases on one day share its group, in title and then episode order", () => {
  const { days } = releaseDays([
    episode("s2", "Severance", [2, 10], "2026-11-20"),
    release({
      id: "p",
      title: "Parasite",
      kind: "physical",
      date: "2026-11-20",
    }),
    episode("s1", "Severance", [2, 9], "2026-11-20"),
    release({ id: "a", title: "Anora", date: "2026-11-20" }),
    episode("f", "Frieren", [2, 7], "2026-11-21"),
  ]);
  expect(days.get("2026-11-20")?.map((event) => event.id)).toEqual([
    "a",
    "p",
    "s1",
    "s2",
  ]);
  expect(days.get("2026-11-21")?.map((event) => event.id)).toEqual(["f"]);
  expect(days.size).toBe(2);
});

test("a release with no date keeps its own group and is put on no day", () => {
  const { days, undated } = releaseDays([
    release({
      id: "u2",
      title: "The Holdovers",
      date: null,
      precision: "unknown",
    }),
    release({ id: "d", date: "2026-11-01" }),
    release({
      id: "u1",
      title: "Anatomy of a Fall",
      date: null,
      precision: "unknown",
    }),
  ]);
  expect(undated.map((event) => event.id)).toEqual(["u1", "u2"]);
  expect([...days.keys()]).toEqual(["2026-11-01"]);
});

test("a release is named by its series or its own title, and says what it is", () => {
  const aired = episode("e", "Severance", [2, 7], "2026-11-12");
  expect(releaseTitle(aired)).toBe("Severance");
  // Named only by its number so far: the number is said once.
  expect(releaseDetail(aired)).toBe("Season 2, episode 7");
  expect(releaseDetail({ ...aired, title: " episode 7 " })).toBe(
    "Season 2, episode 7",
  );
  expect(releaseDetail({ ...aired, title: "Chikhai Bardo" })).toBe(
    "Season 2, episode 7: Chikhai Bardo",
  );
  // Another episode's number is a name of its own, however odd.
  expect(releaseDetail({ ...aired, title: "Episode 8" })).toBe(
    "Season 2, episode 7: Episode 8",
  );
  expect(releaseShortDetail(aired)).toBe("S2 E7");
  // An episode the catalog has not numbered still has its name.
  const unnumbered = { ...aired, seasonNumber: null, episodeNumber: null };
  expect(releaseDetail(unnumbered)).toBe("Episode 7");
  expect(releaseShortDetail(unnumbered)).toBe("Episode 7");

  const film = release({ id: "m", kind: "theatrical" });
  expect(releaseTitle(film)).toBe("Anora");
  expect(releaseDetail(film)).toBe("In cinemas");
  expect(releaseShortDetail(release({ id: "n", kind: "physical" }))).toBe(
    "Disc release",
  );
  expect(releaseDetail(release({ id: "o", kind: "digital" }))).toBe(
    "Digital release",
  );
});

test("a square lists a day that fits and gives a fuller one's last line to the count", () => {
  const five = ["a", "b", "c", "d", "e"].map((id) => release({ id }));
  expect(squareReleases(five.slice(0, 3))).toEqual({
    listed: five.slice(0, 3),
    more: 0,
  });
  expect(squareReleases(five.slice(0, 4))).toEqual({
    listed: five.slice(0, 2),
    more: 2,
  });
  expect(squareReleases(five)).toEqual({ listed: five.slice(0, 2), more: 3 });
  expect(squareReleases([])).toEqual({ listed: [], more: 0 });
  expect(releaseCount(1)).toBe("1 release");
  expect(releaseCount(5)).toBe("5 releases");
});
