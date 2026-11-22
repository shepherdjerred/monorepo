import { expect, test } from "vitest";
import { RemovalListSchema, RequestListSchema } from "#shared/api.ts";
import type { Availability, MediaItem } from "#shared/contract.ts";
import {
  CalendarEventSchema,
  type CalendarEvent,
} from "#shared/household/calendar.ts";
import { RequestInterestViewSchema } from "#shared/household/interests.ts";
import { RecoveryListSchema } from "#shared/recovery.ts";
import { leavingEntries, runStarted } from "#client/library/keep-run.ts";
import type { Interest, Request } from "#client/library/mine-model.ts";
import { leavingTitles } from "#client/library/removals.ts";
import {
  dayHeading,
  firstOfWeek,
  interestChecks,
  onTheWay,
  ownerDecisions,
  playedOf,
  soonestEntries,
  thisWeek,
  weekFrom,
} from "./model.ts";

const me = crypto.randomUUID();
const someoneElse = crypto.randomUUID();

type Asked = {
  root: { id: string; title: string };
  kind: MediaItem["kind"];
  availability: Availability;
  userId?: string;
  active?: boolean;
  season?: number;
  episode?: number;
  name?: string;
};

/** One row of `GET /requests`, for the film or series itself or a part. */
function request(asked: Asked): Request {
  const whole = asked.kind === "movie" || asked.kind === "series";
  const mediaId = whole ? asked.root.id : crypto.randomUUID();
  const [row] = RequestListSchema.parse([
    {
      id: crypto.randomUUID(),
      userId: asked.userId ?? me,
      mediaId,
      active: asked.active ?? true,
      subtitleLanguages: [],
      includeFutureEpisodes: false,
      includeSpecials: false,
      version: 1,
      media: {
        id: mediaId,
        kind: asked.kind,
        title: asked.name ?? asked.root.title,
        year: 2024,
        parentId: whole ? null : asked.root.id,
        seasonNumber: asked.season ?? null,
        episodeNumber: asked.episode ?? null,
        availability: asked.availability,
        version: 1,
      },
      rootMediaId: asked.root.id,
      rootTitle: asked.root.title,
      artwork: { posterPath: "/abcdefgh.jpg", backdropPath: null },
    },
  ]);
  if (row === undefined) throw new Error("No request was built");
  return row;
}

function title(name: string) {
  return { id: crypto.randomUUID(), title: name };
}

function interest(asked: Request, overrides: Partial<Interest> = {}): Interest {
  return RequestInterestViewSchema.parse({
    requestId: asked.id,
    mediaId: asked.mediaId,
    edition: "default",
    userId: asked.userId,
    title: asked.media.title,
    keepingPolicy: "temporary",
    interestState: "following",
    version: 1,
    interestRevision: 0,
    renewedAt: "2026-11-01T00:00:00.000Z",
    releasedAt: null,
    releaseReason: null,
    noticeEventId: crypto.randomUUID(),
    replyBy: null,
    noticeDeliveryState: "accepted",
    noticeReason: null,
    ...overrides,
  });
}

test("a check waits on the reader only while it is theirs, asked, and unanswered", () => {
  const shogun = request({
    root: title("Shōgun"),
    kind: "series",
    availability: "available",
  });
  const answered = request({
    root: title("Hacks"),
    kind: "series",
    availability: "available",
  });
  const neverAsked = request({
    root: title("Severance"),
    kind: "series",
    availability: "available",
  });
  const theirs = request({
    root: title("Bluey"),
    kind: "series",
    availability: "available",
    userId: someoneElse,
  });
  const requests = [shogun, answered, neverAsked, theirs];
  const checks = interestChecks(
    [
      interest(shogun),
      interest(answered, { interestState: "finished" }),
      interest(neverAsked, { noticeEventId: null }),
      // The owner's read also lists a managed profile's interests.
      interest(theirs),
    ],
    requests,
    me,
  );
  expect(checks.map((check) => check.name)).toEqual(["Shōgun"]);
  expect(checks[0]).toMatchObject({
    rootMediaId: shogun.rootMediaId,
    part: null,
    posterPath: "/abcdefgh.jpg",
  });
});

test("a check on a season names its series, once the requests say which", () => {
  const andor = title("Andor");
  const season = request({
    root: andor,
    kind: "season",
    availability: "available",
    season: 2,
    name: "Season 2",
  });
  const waiting = interest(season);
  expect(interestChecks([waiting], [season], me)[0]).toMatchObject({
    name: "Andor",
    part: "Season 2",
    rootMediaId: andor.id,
  });
  // While the requests are still on their way, the interest's own name.
  expect(interestChecks([waiting], [], me)[0]).toMatchObject({
    name: "Season 2",
    part: null,
    rootMediaId: season.mediaId,
  });
});

test("checks are ordered by how soon they are due, the undated last", () => {
  const rows = ["Late", "Undated", "Soon"].map((name) =>
    request({ root: title(name), kind: "movie", availability: "available" }),
  );
  const [late, undated, soon] = rows;
  if (late === undefined || undated === undefined || soon === undefined) {
    throw new Error("Three requests were built");
  }
  const checks = interestChecks(
    [
      interest(late, { replyBy: "2026-12-09T00:00:00.000Z" }),
      interest(undated),
      interest(soon, { replyBy: "2026-11-25T00:00:00.000Z" }),
    ],
    rows,
    me,
  );
  expect(checks.map((check) => check.name)).toEqual([
    "Soon",
    "Late",
    "Undated",
  ]);
});

function recovery(states: readonly string[], held: number) {
  return RecoveryListSchema.parse({
    authority: null,
    holds: Array.from({ length: held }, (_, index) => ({
      mediaId: crypto.randomUUID(),
      title: `Held ${String(index)}`,
      reason: "restored_from_backup",
    })),
    reviews: states.map((state, index) => ({
      id: crypto.randomUUID(),
      state,
      createdAt: "2026-11-01T00:00:00.000Z",
      titles: [`Reviewed ${String(index)}`],
    })),
  });
}

test("the owner decides each open review and the titles still held", () => {
  const list = recovery(["released", "awaiting_responses"], 3);
  expect(ownerDecisions(list)).toEqual([
    {
      kind: "review",
      reviewId: list.reviews[1]?.id,
      titles: ["Reviewed 1"],
    },
    { kind: "held", count: 3 },
  ]);
  expect(ownerDecisions(recovery(["released"], 0))).toEqual([]);
});

test("a review in a state this client does not know fails instead of being guessed at", () => {
  expect(() => ownerDecisions(recovery(["under_appeal"], 0))).toThrow(
    'Unknown recovery review state "under_appeal"',
  );
});

test("what is on the way is the reader's own requests that have not arrived", () => {
  const titles = onTheWay(
    [
      request({
        root: title("Anora"),
        kind: "movie",
        availability: "searching",
      }),
      request({
        root: title("Dune"),
        kind: "movie",
        availability: "available",
      }),
      request({
        root: title("Heat"),
        kind: "movie",
        availability: "downloading",
        active: false,
      }),
      request({
        root: title("Bluey"),
        kind: "series",
        availability: "downloading",
        userId: someoneElse,
      }),
      request({
        root: title("Moonlight"),
        kind: "movie",
        availability: "removed",
      }),
      request({
        root: title("The Holdovers"),
        kind: "movie",
        availability: "quarantined",
      }),
    ],
    me,
    [],
  );
  expect(titles).toHaveLength(1);
  expect(titles[0]).toMatchObject({
    name: "Anora",
    posterPath: "/abcdefgh.jpg",
    stage: { label: "Looking for it", tone: "progress" },
    detail: "The film",
  });
});

test("a series counts its episodes, and the furthest of them says how far it is", () => {
  const severance = title("Severance");
  const episodes = (
    ["available", "available", "importing", "downloading", "wanted"] as const
  ).map((availability, index) =>
    request({
      root: severance,
      kind: "episode",
      availability,
      season: 2,
      episode: index + 1,
      name: `Episode ${String(index + 1)}`,
    }),
  );
  const [arriving] = onTheWay(
    [
      // The series' own row says nothing a list can trust.
      request({ root: severance, kind: "series", availability: "wanted" }),
      ...episodes,
    ],
    me,
    [],
  );
  expect(arriving).toMatchObject({
    name: "Severance",
    stage: { label: "Adding it to the library", tone: "progress" },
    detail: "2 of 5 episodes ready to watch",
  });

  // Every episode is there: nothing is on the way, whatever the series says.
  const bear = title("The Bear");
  expect(
    onTheWay(
      [
        request({ root: bear, kind: "series", availability: "wanted" }),
        request({
          root: bear,
          kind: "episode",
          availability: "available",
          season: 1,
          episode: 1,
        }),
      ],
      me,
      [],
    ),
  ).toEqual([]);
});

test("a request for one season or episode says which", () => {
  const [season, episode] = onTheWay(
    [
      request({
        root: title("Andor"),
        kind: "season",
        availability: "importing",
        season: 2,
        name: "Season 2",
      }),
      request({
        root: title("Arcane"),
        kind: "episode",
        availability: "wanted",
        season: 2,
        episode: 9,
        name: "The Dirt Under Your Nails",
      }),
    ],
    me,
    [],
  );
  expect(season?.detail).toBe("Season 2");
  expect(episode?.detail).toBe(
    "Season 2, episode 9: The Dirt Under Your Nails",
  );
});

test("what is furthest along comes first, then by name", () => {
  const names = onTheWay(
    [
      request({ root: title("Wanted"), kind: "movie", availability: "wanted" }),
      request({
        root: title("Zed"),
        kind: "movie",
        availability: "downloading",
      }),
      request({
        root: title("Almost"),
        kind: "movie",
        availability: "importing",
      }),
      request({
        root: title("Arrival"),
        kind: "movie",
        availability: "downloading",
      }),
    ],
    me,
    [],
  ).map((entry) => entry.name);
  expect(names).toEqual(["Almost", "Arrival", "Zed", "Wanted"]);
});

test("a series counts only the episodes that can be played as ready to watch", () => {
  const severance = title("Severance");
  const episodes = (
    ["downloading", "quarantined", "removed", "available"] as const
  ).map((availability, index) =>
    request({
      root: severance,
      kind: "episode",
      availability,
      season: 2,
      episode: index + 1,
      name: `Episode ${String(index + 1)}`,
    }),
  );
  // One is coming, two are set aside or gone, one can be played.
  expect(onTheWay(episodes, me, [])[0]?.detail).toBe(
    "1 of 4 episodes ready to watch",
  );
  // With nothing played yet, none is ready: a set-aside episode is not.
  expect(onTheWay(episodes.slice(0, 2), me, [])[0]?.detail).toBe(
    "0 of 2 episodes ready to watch",
  );
  expect(
    onTheWay(
      [episodes[0], episodes[2]].flatMap((row) => row ?? []),
      me,
      [],
    )[0]?.detail,
  ).toBe("0 of 2 episodes ready to watch");
});

/** What the reader's interest in a request says, by request. */
function interestIn(asked: Request, interestState: Interest["interestState"]) {
  return interest(asked, { interestState, noticeEventId: null });
}

test("a request the reader let go of is not on the way, whatever its state", () => {
  const rows = (["following", "dropped", "finished", "expired"] as const).map(
    (interestState) => ({
      interestState,
      row: request({
        root: title(`Was ${interestState}`),
        kind: "movie",
        availability: "searching",
      }),
    }),
  );
  const interests = rows.map(({ row, interestState }) =>
    interestIn(row, interestState),
  );
  // The request itself stays active: letting go does not clear it.
  expect(rows.every(({ row }) => row.active)).toBe(true);
  expect(
    onTheWay(
      rows.map(({ row }) => row),
      me,
      interests,
    ).map((entry) => entry.name),
  ).toEqual(["Was following"]);
});

test("a request with no interest of its own is still on the way", () => {
  const film = request({
    root: title("Anora"),
    kind: "movie",
    availability: "searching",
  });
  expect(onTheWay([film], me, []).map((entry) => entry.name)).toEqual([
    "Anora",
  ]);
});

test("a series the reader let go of takes the episodes it covers with it", () => {
  const severance = title("Severance");
  const asked = request({
    root: severance,
    kind: "series",
    availability: "downloading",
  });
  const covered = [1, 2].map((episode) =>
    request({
      root: severance,
      kind: "episode",
      availability: "downloading",
      season: 2,
      episode,
    }),
  );
  const rows = [asked, ...covered];
  expect(onTheWay(rows, me, [interestIn(asked, "following")])).toHaveLength(1);
  for (const state of ["dropped", "finished"] as const) {
    expect(onTheWay(rows, me, [interestIn(asked, state)]), state).toEqual([]);
  }
});

test("a title with one request still followed keeps its covered episodes, and drops the one let go of", () => {
  const andor = title("Andor");
  // An episode asked for on its own, further along than anything else.
  const letGo = request({
    root: andor,
    kind: "episode",
    availability: "importing",
    season: 1,
    episode: 1,
  });
  const kept = request({
    root: andor,
    kind: "season",
    availability: "downloading",
    season: 2,
    name: "Season 2",
  });
  const covered = request({
    root: andor,
    kind: "episode",
    availability: "downloading",
    season: 2,
    episode: 3,
  });
  const [only, ...rest] = onTheWay([letGo, kept, covered], me, [
    interestIn(letGo, "dropped"),
    interestIn(kept, "following"),
  ]);
  expect(rest).toEqual([]);
  // Only what the reader still follows is counted: the dropped episode's
  // "importing" does not make the title look further along.
  expect(only).toMatchObject({
    name: "Andor",
    stage: { label: "Downloading", tone: "progress" },
  });
});

test("an episode asked for on its own is judged by its own interest", () => {
  const arcane = title("Arcane");
  const episode = request({
    root: arcane,
    kind: "episode",
    availability: "wanted",
    season: 2,
    episode: 9,
    name: "The Dirt Under Your Nails",
  });
  expect(
    onTheWay([episode], me, [interestIn(episode, "following")]),
  ).toHaveLength(1);
  expect(onTheWay([episode], me, [interestIn(episode, "dropped")])).toEqual([]);
});

function release(
  date: string | null,
  name: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return CalendarEventSchema.parse({
    id: `${name}:${String(date)}`,
    mediaId: crypto.randomUUID(),
    rootMediaId: crypto.randomUUID(),
    artwork: { posterPath: null, backdropPath: null },
    title: name,
    seriesTitle: null,
    seasonNumber: null,
    episodeNumber: null,
    kind: "digital",
    region: "US",
    date,
    precision: date === null ? "unknown" : "day",
    availability: "wanted",
    observedAt: null,
    ...overrides,
  });
}

test("this week is today and the six days after it, a day at a time", () => {
  const days = thisWeek(
    [
      release("2026-11-30", "Last day"),
      release("2026-11-24", "Today, later in the alphabet"),
      release("2026-11-24", "Another today"),
      release("2026-12-01", "A day too late"),
      release("2026-11-23", "Yesterday"),
      // The calendar lists these whatever range is asked for.
      release(null, "No date yet"),
    ],
    "2026-11-24",
  );
  expect(
    days.map((day) => [day.date, day.events.map((event) => event.title)]),
  ).toEqual([
    ["2026-11-24", ["Another today", "Today, later in the alphabet"]],
    ["2026-11-30", ["Last day"]],
  ]);
  expect(thisWeek([release(null, "No date yet")], "2026-11-24")).toEqual([]);
});

test("a long week shows its first releases and counts the rest", () => {
  const days = thisWeek(
    [
      release("2026-11-24", "A"),
      release("2026-11-24", "B"),
      release("2026-11-25", "C"),
      release("2026-11-26", "D"),
    ],
    "2026-11-24",
  );
  const { days: shown, more } = firstOfWeek(days, 3);
  expect(shown.map((day) => day.events.map((event) => event.title))).toEqual([
    ["A", "B"],
    ["C"],
  ]);
  expect(more).toBe(1);
  expect(firstOfWeek(days, 12)).toEqual({ days, more: 0 });
});

test("a day is named for how near it is, and by its date once it is not", () => {
  expect(dayHeading("2026-11-24", "2026-11-24", "en-US")).toEqual({
    name: "Today",
    date: "Tuesday, November 24",
  });
  expect(dayHeading("2026-11-25", "2026-11-24", "en-US")).toEqual({
    name: "Tomorrow",
    date: "Wednesday, November 25",
  });
  expect(dayHeading("2026-11-26", "2026-11-24", "en-US")).toEqual({
    name: "Thursday, November 26",
    date: null,
  });
  // Tomorrow is the next civil date, across a month and a year.
  expect(dayHeading("2027-01-01", "2026-12-31", "en-US").name).toBe("Tomorrow");
});

test("the week is today and the six days after it", () => {
  expect(weekFrom("2026-11-28")).toEqual({
    from: "2026-11-28",
    to: "2026-12-04",
  });
});

test("a stream says how many minutes of its length have played", () => {
  expect(playedOf(31 * 60_000, 51 * 60_000)).toBe("31 of 51 min");
  // Plex can report a position past the end.
  expect(playedOf(53 * 60_000, 51 * 60_000)).toBe("51 of 51 min");
});

/** Films leaving whole, a day apart, in the order given. */
function leaving(names: readonly string[]) {
  return leavingTitles(
    RemovalListSchema.parse(
      names.map((name, index) => {
        const mediaId = crypto.randomUUID();
        return {
          id: crypto.randomUUID(),
          mediaId,
          rootMediaId: mediaId,
          rootTitle: name,
          artwork: { posterPath: null, backdropPath: null },
          state: "grace_period",
          graceUntil: `2026-12-0${String(index + 1)}T00:00:00.000Z`,
          purgeAfter: null,
          media: { title: name, kind: "movie", version: 1 },
        };
      }),
    ),
  );
}

test("Home lists the three titles that leave first, and any other a keep-all has a report on", () => {
  const titles = leaving(["First", "Second", "Third", "Fourth", "Fifth"]);
  const names = (runs: Parameters<typeof leavingEntries>[1], listed = titles) =>
    soonestEntries(leavingEntries(listed, runs)).map((entry) => [
      entry.run?.title.name ?? entry.current?.name,
      entry.current === null ? "left the list" : "leaving",
    ]);
  expect(names(new Map())).toEqual([
    ["First", "leaving"],
    ["Second", "leaving"],
    ["Third", "leaving"],
  ]);

  // A run on a title further down keeps its report on the page.
  const fifth = titles[4];
  if (fifth === undefined) throw new Error("Five titles were built");
  const runs = runStarted(new Map(), fifth);
  expect(names(runs)).toEqual([
    ["First", "leaving"],
    ["Second", "leaving"],
    ["Third", "leaving"],
    ["Fifth", "leaving"],
  ]);
  // And still does once nothing of the title is listed any more.
  expect(names(runs, titles.slice(0, 2))).toEqual([
    ["First", "leaving"],
    ["Second", "leaving"],
    ["Fifth", "left the list"],
  ]);
});
