import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import type { z } from "zod";
import { RemovalListSchema, RequestListSchema } from "#shared/api.ts";
import { DefaultTargetViewSchema } from "#shared/editions/target-view.ts";
import { CalendarPageSchema } from "#shared/household/calendar.ts";
import { RequestInterestListSchema } from "#shared/household/interests.ts";
import { LibraryPageSchema } from "#shared/household/library.ts";
import { NowPlayingSchema } from "#shared/household/playback.ts";
import { RecoveryListSchema } from "#shared/recovery.ts";
import { ApiError } from "#client/api.ts";
import { localToday } from "#client/calendar/dates.ts";
import { titleNamed } from "./fixtures/titles.ts";
import { personaUser, type Persona } from "./personas.ts";
import { routeFixture } from "./router.ts";
import type { FixtureScenario } from "./scenario.ts";
import { NewInLibrary } from "#client/home/household.tsx";
import { NowPlaying } from "#client/home/personal.tsx";
import { weekFrom } from "#client/home/model.ts";
import { InRouter } from "#client/in-router.test-support.tsx";
import { HomePage } from "#client/home/page.tsx";

/*
 * Home from the answers the fixture API serves, put in the cache under the
 * keys the pages that own those reads use. A section that stopped reading
 * its key, or a key that moved, shows here as a section still loading.
 */

const SECTIONS = [
  "Needs your answer",
  "Now playing",
  "On the way",
  "New in the library",
  "This week",
  "Leaving soon",
] as const;
type SectionName = (typeof SECTIONS)[number];

/** Today and the six days after it. */
const WEEK = weekFrom(localToday());

/** The cache key each section's read is kept under. */
function keys(persona: Persona) {
  return {
    requests: ["requests"],
    interests: ["request-interests", personaUser(persona).id],
    recovery: ["recovery"],
    playing: ["playback", "now"],
    added: [
      "library",
      { query: "", kind: "all", keeping: "all", status: "all", sort: "added" },
    ],
    // The Calendar's own key for a range of days.
    week: ["calendar", WEEK.from, WEEK.to, "all", "all"],
    removals: ["removals"],
  } as const satisfies Record<string, QueryKey>;
}

function served<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  persona: Persona,
  scenario: FixtureScenario,
): z.output<Schema> {
  const outcome = routeFixture({
    method: "GET",
    url: new URL(`http://fixture.invalid/api${path}`),
    persona,
    scenario,
  });
  if (outcome.status !== 200) {
    throw new Error(`${path}: HTTP ${String(outcome.status)}`);
  }
  return schema.parse(outcome.body);
}

/** One page holding everything, as a list read to its end keeps it. */
function wholeList<Item>(items: readonly Item[]) {
  return { pages: [{ items, nextCursor: null }], pageParams: [null] };
}

function interests(persona: Persona, scenario: FixtureScenario) {
  const items = [];
  let cursor: string | null = null;
  do {
    const page: z.output<typeof RequestInterestListSchema> = served(
      `/v1/request-interests?include=artwork${cursor === null ? "" : `&cursor=${cursor}`}`,
      RequestInterestListSchema,
      persona,
      scenario,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return items;
}

/** A cache holding every answer Home reads, as the fixture API gives them. */
function answered(persona: Persona, scenario: FixtureScenario = "default") {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const key = keys(persona);
  client.setQueryData(
    key.requests,
    served("/v1/requests", RequestListSchema, persona, scenario),
  );
  client.setQueryData(key.interests, wholeList(interests(persona, scenario)));
  client.setQueryData(
    key.recovery,
    served("/v1/recovery", RecoveryListSchema, persona, scenario),
  );
  client.setQueryData(
    key.playing,
    served("/v1/playback/now-playing", NowPlayingSchema, persona, scenario),
  );
  client.setQueryData(key.added, {
    pages: [
      served(
        "/v1/library?sort=added&limit=48",
        LibraryPageSchema,
        persona,
        scenario,
      ),
    ],
    pageParams: [null],
  });
  client.setQueryData(
    key.week,
    wholeList(
      served(
        `/v1/calendar?from=${WEEK.from}&to=${WEEK.to}&kind=all&status=all`,
        CalendarPageSchema,
        persona,
        scenario,
      ).events,
    ),
  );
  client.setQueryData(
    key.removals,
    served("/v1/removals", RemovalListSchema, persona, scenario),
  );
  return client;
}

function render(client: QueryClient, page: ReactNode): string {
  return renderToString(
    <QueryClientProvider client={client}>
      <InRouter>{page}</InRouter>
    </QueryClientProvider>,
  );
}

function home(client: QueryClient, persona: Persona): string {
  return render(client, <HomePage user={personaUser(persona)} />);
}

function headings(html: string): string[] {
  return [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/gu)].map(
    (match) => match[1] ?? "",
  );
}

/** The markup of one section: from its heading to the next one's. */
function section(html: string, name: SectionName): string {
  const start = html.indexOf(`>${name}</h2>`);
  if (start === -1) throw new Error(`Home has no “${name}” section`);
  const next = html.indexOf("<h2", start);
  return html.slice(start, next === -1 ? undefined : next);
}

function count(html: string, text: string): number {
  return html.split(text).length - 1;
}

test("a member's Home has every section, in the order they matter", () => {
  const html = home(answered("member"), "member");
  expect(headings(html)).toEqual([...SECTIONS]);
  expect(html).toContain("<title>Home · Media</title>");
  expect(html).not.toContain("Welcome,");
});

test("needs your answer: the reader's open checks, each with one main answer", () => {
  const needs = section(
    home(answered("member"), "member"),
    "Needs your answer",
  );
  // The three checks the interests read marks as waiting, soonest due first.
  expect(count(needs, "Still watching?")).toBe(3);
  expect(needs.indexOf("Shōgun")).toBeLessThan(needs.indexOf("Slow Horses"));
  expect(needs).toContain("Answer by ");
  expect(needs).toContain(`href="/media/${titleNamed("Shōgun").id}"`);
  for (const answer of [
    "Keep watching",
    "I have finished it",
    "Stop following",
  ]) {
    expect(count(needs, `>${answer}</button>`), answer).toBe(3);
  }
  expect(count(needs, 'class="button primary"')).toBe(3);
  // Nothing a restore left is the member's to decide, even with the read
  // in the cache.
  expect(needs).not.toContain("review");
  expect(needs).not.toContain("/recovery");
});

test("needs your answer: the owner also has what a restore left to decide", () => {
  const needs = section(home(answered("owner"), "owner"), "Needs your answer");
  expect(count(needs, "Still watching?")).toBe(3);
  expect(needs).toContain("A household review is open");
  expect(needs).toContain("Breaking Bad and Better Call Saul stay protected");
  expect(needs).toContain(
    'href="/recovery/00000010-0000-4000-8000-000000000001"',
  );
  expect(needs).toContain("6 titles are held after a restore");
  expect(needs).toContain('href="/recovery"');
  // Released reviews are not waiting on anyone.
  expect(needs).not.toContain("The Godfather");
  // The links are not a second main action.
  expect(count(needs, 'class="button primary"')).toBe(3);
});

test("now playing: the reader's stream for a member, the household's for the owner", () => {
  const severance = `href="/media/${titleNamed("Severance").id}"`;
  const member = section(home(answered("member"), "member"), "Now playing");
  expect(count(member, "<li")).toBe(1);
  expect(member).toContain(severance);
  expect(member).toContain("Chikhai Bardo");
  expect(member).toContain("On Apple TV");
  expect(member).toContain("Playing");
  expect(member).toMatch(
    /<progress[^>]*aria-label="How far Severance has played"/u,
  );

  const owner = section(home(answered("owner"), "owner"), "Now playing");
  expect(count(owner, "<li")).toBe(2);
  expect(owner).toContain("Kids, on LG webOS");
  expect(owner).toContain("Paused");
  // How a stream is being served is the server's business.
  expect(owner).not.toMatch(/transcode|direct/iu);
});

test("now playing: a stream Media cannot match to a title is named, not linked", () => {
  const client = answered("member");
  const key = keys("member").playing;
  const now = NowPlayingSchema.parse(client.getQueryData(key));
  client.setQueryData(key, {
    ...now,
    items: now.items.map((item) => ({ ...item, media: null })),
  });
  const playing = section(home(client, "member"), "Now playing");
  expect(playing).toContain("Severance");
  expect(playing).not.toContain("<a ");

  // Media cannot see Plex: what it last saw is not what is playing.
  client.setQueryData(key, { ...now, stale: true });
  expect(headings(home(client, "member"))).not.toContain("Now playing");
});

test("on the way: what the reader asked for that has not arrived, furthest first", () => {
  const way = section(home(answered("member"), "member"), "On the way");
  expect(count(way, "<li")).toBe(6);
  expect(way.indexOf("Andor")).toBeLessThan(way.indexOf("Anora"));
  expect(way).toContain("Adding it to the library");
  expect(way).toContain("Looking for it");
  expect(way).toContain('href="/library/mine"');
  expect(way).toContain('aria-label="See all: everything you asked for"');
  // A film that is there, and a request that was withdrawn.
  expect(way).not.toContain("Dune: Part Two");
  expect(way).not.toContain("Hacks");
  expect(way).not.toMatch(/downloading|validating|importing|wanted/u);
});

test("new in the library: the library's own newest-first read, as a rail", () => {
  const added = section(
    home(answered("member"), "member"),
    "New in the library",
  );
  expect(added).toContain('aria-label="New in the library"');
  expect(count(added, "<li")).toBe(20);
  expect(added).toMatch(/Added [A-Z][a-z]{2} \d{1,2}/u);
  expect(added).toContain('href="/library?sort=added"');
  expect(added).toContain('aria-label="See all: New in the library"');
});

test("this week: the next seven days, a day at a time", () => {
  const week = section(home(answered("member"), "member"), "This week");
  expect(week).toContain(">Today</time>");
  // The Calendar's own rows, a list to a day, each release linked to its
  // title's page.
  expect(week).toContain('aria-label="Today"');
  expect(week).toMatch(/<li[^>]*>.*?href="\/media\/[\da-f-]{36}"/su);
  expect(week).toMatch(/Season \d+, episode \d+: |release|In cinemas/u);
  expect(week).toContain('href="/calendar"');
  // No release without a date is this week's.
  expect(week).not.toContain("The Holdovers");
});

test("leaving soon: the three that leave first, each with its keep", () => {
  const client = answered("member");
  // What the section's one batched read of the titles' targets leaves in
  // the cache: each title's own view.
  for (const removal of RemovalListSchema.parse(
    client.getQueryData(keys("member").removals),
  )) {
    client.setQueryData(
      ["target", removal.mediaId],
      served(
        `/v2/media/${removal.mediaId}/targets/default`,
        DefaultTargetViewSchema,
        "member",
        "default",
      ),
    );
  }
  const leaving = section(home(client, "member"), "Leaving soon");
  expect(count(leaving, ">Keep for 30 days</button>")).toBe(
    // Get Out and Mr. Robot, and each of The Expanse's four episodes.
    6,
  );
  for (const name of ["Get Out", "The Expanse", "Mr. Robot"]) {
    expect(leaving, name).toContain(`>${name}</a>`);
  }
  expect(leaving).not.toContain("Cowboy Bebop");
  expect(leaving).toMatch(/Leaving [A-Z][a-z]{2} \d{1,2}/u);
  expect(leaving).toContain('href="/library/leaving"');
  expect(leaving).toContain(">See all 6</a>");
  // Several episodes of one series leave together: one action keeps them.
  expect(leaving).toContain("Keep all 4 episodes");
});

const EMPTY: Record<
  SectionName,
  (client: QueryClient, persona: Persona) => void
> = {
  "Needs your answer": (client, persona) => {
    client.setQueryData(keys(persona).interests, wholeList([]));
    client.setQueryData(keys(persona).recovery, {
      authority: null,
      holds: [],
      reviews: [],
    });
  },
  "Now playing": (client, persona) => {
    client.setQueryData(keys(persona).playing, {
      observedAt: null,
      stale: false,
      items: [],
    });
  },
  "On the way": (client, persona) => {
    client.setQueryData(keys(persona).requests, []);
  },
  "New in the library": (client, persona) => {
    client.setQueryData(keys(persona).added, wholeList([]));
  },
  "This week": (client, persona) => {
    client.setQueryData(keys(persona).week, wholeList([]));
  },
  "Leaving soon": (client, persona) => {
    client.setQueryData(keys(persona).removals, []);
  },
};

test.each(SECTIONS)(
  "%s is not on the page when its read has nothing in it",
  (name) => {
    for (const persona of ["member", "owner"] as const) {
      const client = answered(persona);
      EMPTY[name](client, persona);
      expect(headings(home(client, persona)), persona).toEqual(
        SECTIONS.filter((other) => other !== name),
      );
    }
  },
);

test("with nothing in any section, Home is a welcome that points to Discover", () => {
  for (const persona of ["member", "owner"] as const) {
    const html = home(answered(persona, "new-household"), persona);
    expect(headings(html), persona).toEqual([
      `Welcome, ${personaUser(persona).displayName}`,
    ]);
    expect(html).toContain('<a class="button primary" href="/discover"');
    expect(html).toContain("Find something to watch");
    expect(html).toContain('href="/library"');
  }
});

/** The two sections that are empty for most people, most of the time. */
const USUALLY_EMPTY = new Set<string>(["Needs your answer", "Now playing"]);

test("until its read answers, a section that usually has content holds its place; the two that usually have none take no room", () => {
  const html = home(new QueryClient(), "member");
  const held = SECTIONS.filter((name) => !USUALLY_EMPTY.has(name));
  expect(headings(html)).toEqual(held);
  expect(count(html, 'role="status"')).toBe(held.length);
  expect(html).toContain("Loading what is on the way");
  expect(html).toContain("Loading what is new");
  expect(html).not.toContain("Welcome,");
  // "See all" leads nowhere worth going while there is nothing to see.
  expect(html).not.toContain("See all");
});

test.each([
  ["what a restore left for the owner", "recovery"],
  ["what is playing", "playing"],
] as const)(
  "the welcome waits for %s, which holds no place while it loads",
  (_what, pending) => {
    // Every other read has answered, with nothing.
    const client = answered("owner", "new-household");
    client.removeQueries({ queryKey: keys("owner")[pending] });
    const html = home(client, "owner");
    expect(html).not.toContain("Welcome,");
    // Nothing is on the page for it either: no heading, no placeholder.
    expect(headings(html)).toEqual([]);
    expect(html).not.toContain('role="status"');
  },
);

test("the welcome waits for the reader's interests, which only On the way waits on with a placeholder", () => {
  const client = answered("owner", "new-household");
  client.removeQueries({ queryKey: keys("owner").interests });
  const html = home(client, "owner");
  expect(html).not.toContain("Welcome,");
  // Needs your answer holds no place; On the way does, as it needs them too,
  // and lists nothing until they are in.
  expect(headings(html)).toEqual(["On the way"]);
  expect(html).toContain("Loading what is on the way");
});

test("a request the reader let go of is not listed while the interests are still out", () => {
  const client = answered("member");
  client.removeQueries({ queryKey: keys("member").interests });
  const html = home(client, "member");
  // The requests are answered, but nothing is listed until the interests
  // say which of them the reader still follows.
  expect(section(html, "On the way")).toContain("Loading what is on the way");
  expect(section(html, "On the way")).not.toContain("Princess Mononoke");
  expect(section(html, "On the way")).not.toContain("Andor");
});

test("a section that holds no place still says so when its read fails", () => {
  const failed = {
    items: [],
    pending: false,
    error: new ApiError("internal_error", "The operation failed", 500),
    retry: () => {
      /* not pressed */
    },
  };
  const html = render(
    new QueryClient(),
    <NowPlaying user={personaUser("member")} read={failed} />,
  );
  expect(headings(html)).toEqual(["Now playing"]);
  expect(html).toContain("What is playing did not load");
  // And takes no room while it is only loading.
  expect(
    render(
      new QueryClient(),
      <NowPlaying
        user={personaUser("member")}
        read={{ ...failed, pending: true, error: null }}
      />,
    ),
  ).toBe("");
});

test("a read that fails says so in its own section, in the room its content takes", () => {
  const html = render(
    new QueryClient(),
    <NewInLibrary
      read={{
        items: [],
        pending: false,
        error: new ApiError("internal_error", "The operation failed", 500),
        retry: () => {
          /* not pressed */
        },
      }}
    />,
  );
  expect(headings(html)).toEqual(["New in the library"]);
  expect(html).toContain('role="alert"');
  // Under the section's own heading, not beside it.
  expect(html).toMatch(/<h3[^>]*>What is new in the library did not load/u);
  expect(html).toContain("Media ran into a problem on its side.");
  expect(html).toContain(">Try again</button>");
  expect(html).not.toContain("See all");
});
