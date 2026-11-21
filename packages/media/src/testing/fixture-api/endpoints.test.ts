import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  CatalogSearchSchema,
  ProfileListSchema,
  QualityRulesSchema,
  RemovalListSchema,
  RequestListSchema,
} from "#shared/api.ts";
import { CatalogFeedSchema } from "#shared/catalog/contract.ts";
import {
  ApiErrorSchema,
  AvailabilitySchema,
  UserRoleSchema,
} from "#shared/contract.ts";
import { RequestInterestListSchema } from "#shared/household/interests.ts";
import { LibraryPageSchema } from "#shared/household/library.ts";
import type { FixtureEndpoint } from "./endpoint.ts";
import { FIXTURE_ENDPOINTS } from "./endpoints.ts";
import { TITLES } from "./fixtures/titles.ts";
import type { Persona } from "./personas.ts";
import { routeFixture } from "./router.ts";

function read(endpoint: FixtureEndpoint, sample: string, persona: Persona) {
  return routeFixture({
    method: "GET",
    url: new URL(
      `http://fixture.invalid/api/v${String(endpoint.version)}${sample}`,
    ),
    persona,
  });
}

/** The body as a browser receives it: serialized, then read back. */
async function overTheWire(body: unknown): Promise<unknown> {
  return Response.json(body).json();
}

async function readInterests(query: string) {
  const outcome = routeFixture({
    method: "GET",
    url: new URL(`http://fixture.invalid/api/v1/request-interests${query}`),
    persona: "member",
  });
  return { outcome, body: await overTheWire(outcome.body) };
}

async function readCatalog(path: string) {
  const outcome = routeFixture({
    method: "GET",
    url: new URL(`http://fixture.invalid/api/v1/catalog/${path}`),
    persona: "member",
  });
  const page = CatalogSearchSchema.safeParse(await overTheWire(outcome.body));
  return { status: outcome.status, results: page.data?.results, page };
}

async function readLibrary(query: string) {
  const outcome = routeFixture({
    method: "GET",
    url: new URL(`http://fixture.invalid/api/v1/library?${query}`),
    persona: "member",
  });
  const page = LibraryPageSchema.safeParse(await overTheWire(outcome.body));
  return { status: outcome.status, page: page.data };
}

/** Follow `nextCursor` to the end, as the client's "load more" does. */
async function readWholeLibrary(query: string) {
  const items: z.infer<typeof LibraryPageSchema>["items"] = [];
  let firstCursor: string | null = null;
  let cursor: string | null = null;
  do {
    const { page } = await readLibrary(
      cursor === null ? query : `${query}&cursor=${encodeURIComponent(cursor)}`,
    );
    if (page === undefined) {
      throw new Error(`The library refused ${query}`);
    }
    items.push(...page.items);
    cursor = page.nextCursor;
    firstCursor ??= cursor;
  } while (cursor !== null);
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  return { items, firstCursor };
}

async function readRemovals(persona: Persona) {
  const outcome = routeFixture({
    method: "GET",
    url: new URL("http://fixture.invalid/api/v1/removals"),
    persona,
  });
  return RemovalListSchema.parse(await overTheWire(outcome.body));
}

describe("fixture endpoints", () => {
  it("names every route once", () => {
    const routes = FIXTURE_ENDPOINTS.map(
      (endpoint) => `v${String(endpoint.version)}${endpoint.path}`,
    );
    expect(new Set(routes).size).toBe(routes.length);
  });

  describe.each(
    FIXTURE_ENDPOINTS.map((endpoint) => ({
      route: `/api/v${String(endpoint.version)}${endpoint.path}`,
      endpoint,
    })),
  )("$route", ({ endpoint }) => {
    it("has a sample to validate", () => {
      expect(endpoint.samples.length).toBeGreaterThan(0);
    });

    it("answers every sample with a body its client schema accepts", async () => {
      const personas = UserRoleSchema.options.filter(
        (persona) => endpoint.access === "household" || persona === "owner",
      );
      for (const persona of personas) {
        for (const sample of endpoint.samples) {
          const outcome = read(endpoint, sample, persona);
          if (outcome.status !== 200) {
            throw new Error(
              `${persona} ${sample}: HTTP ${String(outcome.status)} ${outcome.body.error.message}`,
            );
          }
          // The sample must reach the endpoint that declares it, not a
          // neighbouring route that happens to match the same path.
          expect(outcome.endpoint, `${persona} ${sample}`).toBe(endpoint);
          const received = await overTheWire(outcome.body);
          expect(
            () => endpoint.parse(received, outcome.request),
            `${persona} ${sample}`,
          ).not.toThrow();
        }
      }
    });

    it("refuses a member exactly when the route is owner-only", () => {
      const [sample] = endpoint.samples;
      if (sample === undefined) {
        throw new Error(`${endpoint.path} has no sample`);
      }
      const outcome = read(endpoint, sample, "member");
      if (endpoint.access === "household") {
        expect(outcome.status).toBe(200);
        return;
      }
      expect(outcome.status).toBe(403);
      expect(ApiErrorSchema.parse(outcome.body).error.code).toBe("forbidden");
    });
  });
});

describe("fixture volume", () => {
  it("holds a production-sized library", () => {
    expect(TITLES.length).toBeGreaterThanOrEqual(60);
  });

  it("shows every availability state in the library", () => {
    const shown = new Set(TITLES.map((title) => title.availability));
    expect([...shown].sort()).toEqual([...AvailabilitySchema.options].sort());
  });

  it("shows every keeping policy, interest, and protection in the library", async () => {
    const outcome = routeFixture({
      method: "GET",
      url: new URL("http://fixture.invalid/api/v1/library?limit=50"),
      persona: "owner",
    });
    const { items } = LibraryPageSchema.parse(await overTheWire(outcome.body));
    const element = LibraryPageSchema.shape.items.element.shape;
    expect(new Set(items.map((item) => item.policy))).toEqual(
      new Set(element.policy.options),
    );
    expect(new Set(items.map((item) => item.myInterest))).toEqual(
      new Set(element.myInterest.options),
    );
    expect(new Set(items.map((item) => item.protection))).toEqual(
      new Set(element.protection.options),
    );
  });

  it("shows titles with a poster and a backdrop, with one of them, and with neither", async () => {
    const outcome = routeFixture({
      method: "GET",
      url: new URL("http://fixture.invalid/api/v1/library?limit=50"),
      persona: "member",
    });
    const { items } = LibraryPageSchema.parse(await overTheWire(outcome.body));
    const shapes = new Set(
      items.map(
        ({ artwork }) =>
          `${artwork.posterPath === null ? "no poster" : "poster"}, ${artwork.backdropPath === null ? "no backdrop" : "backdrop"}`,
      ),
    );
    expect([...shapes].sort()).toEqual([
      "no poster, backdrop",
      "no poster, no backdrop",
      "poster, backdrop",
      "poster, no backdrop",
    ]);
    const paths = items
      .flatMap(({ artwork }) => [artwork.posterPath, artwork.backdropPath])
      .filter((path) => path !== null);
    for (const path of paths) {
      expect(path).toMatch(/^\/[0-9a-f]{27}\.png$/u);
    }
  });

  it("shows every state a catalog card can be in, pages each feed, and refuses a bad feed or page", async () => {
    const search = await readCatalog("search?q=the");
    const cards = (search.results ?? []).map(({ library }) => {
      if (library === null) return "not in library";
      if (library.availability === "available") return "available movie";
      if (library.availability !== null)
        return library.requested ? "movie on the way" : "movie not available";
      if (library.episodes === null) return "series, episodes unknown";
      return library.episodes.available < library.episodes.total
        ? "series partly available"
        : "series available";
    });
    expect([...new Set(cards)].sort()).toEqual([
      "available movie",
      "movie not available",
      "movie on the way",
      "not in library",
      "series available",
      "series partly available",
      "series, episodes unknown",
    ]);
    for (const feed of CatalogFeedSchema.options) {
      const first = await readCatalog(`discover?feed=${feed}`);
      expect(first.results?.length, feed).toBeGreaterThan(0);
      expect(first.page.data?.totalPages, feed).toBeLessThanOrEqual(5);
    }
    const first = await readCatalog("discover?feed=trending");
    const second = await readCatalog("discover?feed=trending&page=2");
    expect(second.page.data).toMatchObject({ page: 2 });
    expect(second.results?.[0]).not.toEqual(first.results?.[0]);
    for (const path of [
      "discover",
      "discover?feed=popular",
      "discover?feed=trending&page=6",
      "search?q=the&page=0",
    ]) {
      const refused = await readCatalog(path);
      expect(refused.status, path).toBe(400);
    }
  });

  it("adds artwork to request interests only for a caller that asks for it", async () => {
    const plain = await readInterests("");
    expect(JSON.stringify(plain.body)).not.toContain("artwork");
    const requested = await readInterests("?include=artwork");
    const { items } = RequestInterestListSchema.parse(requested.body);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.artwork !== undefined)).toBe(true);
    const unknown = await readInterests("?include=progress");
    expect(unknown.outcome.status).toBe(400);
  });

  it("names the series of a requested season or episode, and a root row by its own title", async () => {
    const outcome = routeFixture({
      method: "GET",
      url: new URL("http://fixture.invalid/api/v1/requests"),
      persona: "member",
    });
    const requests = RequestListSchema.parse(await overTheWire(outcome.body));
    const named = (kind: string) =>
      requests
        .filter((row) => row.media.kind === kind)
        .map((row) => [row.media.title, row.rootTitle]);
    expect(named("season")).toEqual([
      ["Season 2", "Andor"],
      ["Season 2", "The Last of Us"],
    ]);
    expect(named("episode")).toEqual([["The Dirt Under Your Nails", "Arcane"]]);
    const roots = requests.filter((row) => row.rootMediaId === row.mediaId);
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.every((row) => row.rootTitle === row.media.title)).toBe(true);
    for (const persona of ["owner", "member"] as const) {
      const removals = await readRemovals(persona);
      expect(removals.length).toBeGreaterThan(0);
      expect(removals.every((row) => row.rootTitle === row.media.title)).toBe(
        true,
      );
    }
  });

  it("gives every quality profile rules the profile editor accepts", async () => {
    const outcome = routeFixture({
      method: "GET",
      url: new URL("http://fixture.invalid/api/v1/profiles"),
      persona: "owner",
    });
    // The client parses `rules` a second time when it opens a profile.
    const profiles = ProfileListSchema.parse(await overTheWire(outcome.body));
    for (const profile of profiles) {
      expect(
        () => QualityRulesSchema.parse(profile.rules),
        profile.name,
      ).not.toThrow();
    }
  });
});

describe("library and leaving soon fixtures", () => {
  it("pages the library by title and by date added, and refuses a cursor from the other sort", async () => {
    const all = await readWholeLibrary("sort=title&limit=7");
    expect(all.items.map((item) => item.id).sort()).toEqual(
      TITLES.map((title) => title.id).sort(),
    );
    const added = await readWholeLibrary("sort=added&limit=7");
    const dates = added.items.map((item) => item.addedAt ?? "missing");
    expect(dates).not.toContain("missing");
    expect(dates).toEqual([...dates].sort().reverse());
    // Only what can be played has a date, so the added order is a subset.
    expect(added.items.length).toBeGreaterThan(0);
    expect(added.items.length).toBeLessThan(TITLES.length);
    expect(all.items.filter((item) => item.addedAt === null)).toHaveLength(
      TITLES.length - added.items.length,
    );
    for (const { sort, cursor } of [
      { sort: "title", cursor: added.firstCursor },
      { sort: "added", cursor: all.firstCursor },
    ]) {
      if (cursor === null) {
        throw new Error("The fixture library fit on one page");
      }
      const refused = await readLibrary(
        `sort=${sort}&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(refused.status, sort).toBe(400);
    }
  });

  it("filters the library by policy, interest, leaving and availability, and counts each series' episodes", async () => {
    const { items } = await readWholeLibrary("limit=50");
    for (const policy of ["keep", "temporary", "unclassified"] as const) {
      const page = await readWholeLibrary(`policy=${policy}&limit=50`);
      expect(page.items.map((item) => item.id)).toEqual(
        items.filter((item) => item.policy === policy).map((item) => item.id),
      );
    }
    const mine = await readWholeLibrary("mine=following&limit=50");
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.every((item) => item.myInterest === "following")).toBe(
      true,
    );
    const leaving = await readWholeLibrary("leaving=soon");
    expect(
      new Set(leaving.items.map((item) => item.leavingSoon?.state)),
    ).toEqual(new Set(["warning_pending", "grace_period"]));
    expect(items.filter((item) => item.leavingSoon !== null)).toHaveLength(
      leaving.items.length,
    );
    const available = await readWholeLibrary("availability=available&limit=50");
    const unavailable = await readWholeLibrary(
      "availability=unavailable&limit=50",
    );
    expect(available.items.length + unavailable.items.length).toBe(
      items.length,
    );
    expect(unavailable.items.every((item) => item.addedAt === null)).toBe(true);
    const series = items
      .filter((item) => item.kind === "series")
      .map(({ availability, episodes }) => {
        expect(availability).toBeNull();
        if (episodes === null) return "unknown";
        if (episodes.available === 0) return "none";
        return episodes.available < episodes.total ? "some" : "all";
      });
    expect([...new Set(series)].sort()).toEqual([
      "all",
      "none",
      "some",
      "unknown",
    ]);
    const movies = items.filter((item) => item.kind === "movie");
    expect(movies.every((item) => item.episodes === null)).toBe(true);
    expect(movies.every((item) => item.availability !== null)).toBe(true);
  });

  it("shows a member every title that is leaving soon, and a quarantined one only when they asked for it", async () => {
    const owner = await readRemovals("owner");
    const member = await readRemovals("member");
    const leaving = (list: typeof owner) =>
      list.filter((row) => row.state !== "quarantined").map((row) => row.id);
    expect(leaving(member)).toEqual(leaving(owner));
    expect(leaving(member).length).toBeGreaterThan(0);
    const quarantined = (list: typeof owner) =>
      list.filter((row) => row.state === "quarantined");
    expect(quarantined(member).length).toBeGreaterThan(0);
    expect(quarantined(member).length).toBeLessThan(quarantined(owner).length);
  });
});
