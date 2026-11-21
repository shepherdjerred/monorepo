import { describe, expect, it } from "vitest";
import {
  CatalogSearchSchema,
  ProfileListSchema,
  QualityRulesSchema,
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
      expect(path).toMatch(/^\/[0-9a-f]{27}\.jpg$/u);
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
