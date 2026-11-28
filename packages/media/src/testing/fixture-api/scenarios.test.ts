import { describe, expect, it } from "vitest";
import { householdState } from "#client/discover/card.ts";
import { CatalogDetailSchema, CatalogSearchSchema } from "#shared/api.ts";
import { CatalogFeedSchema } from "#shared/catalog/contract.ts";
import { ApiErrorSchema } from "#shared/contract.ts";
import { AttachImportedRequestsSchema } from "#shared/personal-migration/contract.ts";
import { UNAVAILABLE_FEED } from "./fixtures/catalog.ts";
import { FEATURED } from "./fixtures/titles.ts";
import { FixtureScenarioSchema, SCENARIO_COOKIE } from "./scenario.ts";
import {
  createFixtureApi,
  FIXTURE_CSRF_COOKIE,
  FIXTURE_CSRF_TOKEN,
  PERSONA_COOKIE,
} from "./server.ts";

const handle = createFixtureApi({
  defaultPersona: "member",
  log: () => {
    /* nothing here is unknown or a write */
  },
});

/** One read of the catalog, as a browser in `scenario` makes it. */
async function read(path: string, scenario?: string) {
  const response = handle(
    new Request(`http://fixture.invalid/api/v1/catalog/${path}`, {
      headers:
        scenario === undefined
          ? {}
          : { cookie: `${SCENARIO_COOKIE}=${scenario}` },
    }),
  );
  if (response === null) throw new Error(`${path} was not handled`);
  return { status: response.status, body: (await response.json()) as unknown };
}

async function page(path: string, scenario?: string) {
  const { status, body } = await read(path, scenario);
  if (status !== 200) throw new Error(`${path}: HTTP ${String(status)}`);
  return CatalogSearchSchema.parse(body);
}

async function errorCode(path: string, scenario: string) {
  const { status, body } = await read(path, scenario);
  return { status, code: ApiErrorSchema.parse(body).error.code };
}

const FEED_PATHS = CatalogFeedSchema.options.map(
  (feed) => `discover?feed=${feed}`,
);
const DOWN = { status: 502, code: "catalog_unavailable" };

describe("fixture scenarios", () => {
  it("shows every state a discover card can be in, on the first page of the feeds", async () => {
    const shown = new Set<string>();
    for (const path of FEED_PATHS) {
      const { results, libraryAccess } = await page(path);
      for (const { library } of results) {
        const { state, note } = householdState(library, libraryAccess);
        // An episode count reads as "some of it" whatever the numbers are.
        shown.add((state?.label ?? "").replace(/^\d+ of \d+ /u, "some "));
        if (note !== null) shown.add(note);
      }
    }
    expect([...shown].sort()).toEqual(
      [
        "Request",
        "Ready to watch",
        "On the way",
        "Looking for it",
        "Not found yet",
        "No episodes yet",
        "some episodes",
        "In the library",
        "Removed",
        "Removed, can be restored",
        "You follow this",
        "Others follow this",
      ].sort(),
    );
  });

  it("lists mostly titles the household has not asked for, as a real feed does", async () => {
    for (const path of FEED_PATHS) {
      const { results } = await page(path);
      const outside = results.filter(({ library }) => library === null);
      expect(outside.length, path).toBeGreaterThan(results.length / 2);
      expect(outside.length, path).toBeLessThan(results.length);
    }
  });

  it("pages a search and every feed that has more than one page", async () => {
    const first = await page("search?q=the");
    expect(first.totalPages).toBeGreaterThan(1);
    const second = await page("search?q=the&page=2");
    expect(second.results.length).toBeGreaterThan(0);
    expect(second.results[0]).not.toEqual(first.results[0]);
    const trending = await page("discover?feed=trending");
    expect(trending.totalPages).toBeGreaterThan(1);
  });

  it("stale-library-access: no catalog read says what the household has", async () => {
    for (const path of [...FEED_PATHS, "search?q=the", "search?q=the&page=2"]) {
      const { results, libraryAccess } = await page(
        path,
        "stale-library-access",
      );
      expect(libraryAccess, path).toBe("stale");
      expect(results.length, path).toBeGreaterThan(0);
      expect(
        results.every(({ library }) => library === null),
        path,
      ).toBe(true);
    }
    const { body } = await read(
      `series/${String(FEATURED.series.tmdbId)}`,
      "stale-library-access",
    );
    expect(CatalogDetailSchema.parse(body)).toMatchObject({
      libraryAccess: "stale",
      library: null,
    });
  });

  it("feed-unavailable: one feed is down; the others and search answer", async () => {
    for (const feed of CatalogFeedSchema.options) {
      const path = `discover?feed=${feed}`;
      if (feed === UNAVAILABLE_FEED) {
        expect(await errorCode(path, "feed-unavailable"), feed).toEqual(DOWN);
        expect(
          await errorCode(`${path}&page=2`, "feed-unavailable"),
          feed,
        ).toEqual(DOWN);
      } else {
        const { results } = await page(path, "feed-unavailable");
        expect(results.length, feed).toBeGreaterThan(0);
      }
    }
    const found = await page("search?q=the", "feed-unavailable");
    expect(found.results.length).toBeGreaterThan(0);
  });

  it("catalog-unavailable: every catalog read is down, as when TMDB is", async () => {
    for (const path of [
      ...FEED_PATHS,
      "search?q=the",
      `movie/${String(FEATURED.movie.tmdbId)}`,
    ]) {
      expect(await errorCode(path, "catalog-unavailable"), path).toEqual(DOWN);
    }
    // A request the real route would refuse is still refused first.
    const refused = await read("discover?feed=popular", "catalog-unavailable");
    expect(refused.status).toBe(400);
  });

  it("is chosen by a browser, and an unknown one is refused instead of ignored", async () => {
    for (const scenario of FixtureScenarioSchema.options) {
      const chosen = handle(
        new Request(`http://fixture.invalid/api/fixture/scenario/${scenario}`),
      );
      expect(chosen?.status, scenario).toBe(303);
      expect(chosen?.headers.get("location")).toBe("/");
      expect(chosen?.headers.get("set-cookie"), scenario).toContain(
        `${SCENARIO_COOKIE}=${scenario};`,
      );
    }
    const unknown = handle(
      new Request("http://fixture.invalid/api/fixture/scenario/on-fire"),
    );
    expect(unknown?.status).toBe(400);
    expect(await errorCode("search?q=the", "on-fire")).toEqual({
      status: 400,
      code: "fixture_scenario_invalid",
    });
  });

  it("issues a CSRF cookie on session reads and persona switches so writes reach the 501 router", async () => {
    const logged: string[] = [];
    const api = createFixtureApi({
      defaultPersona: "owner",
      log: (line) => {
        logged.push(line);
      },
    });
    const expectedCsrf = `${FIXTURE_CSRF_COOKIE}=${FIXTURE_CSRF_TOKEN}; Path=/; SameSite=Lax`;

    const me = api(new Request("http://fixture.invalid/api/v1/me"));
    expect(me?.status).toBe(200);
    expect(me?.headers.getSetCookie()).toEqual([expectedCsrf]);

    const meWithExistingCsrf = api(
      new Request("http://fixture.invalid/api/v1/me", {
        headers: { cookie: `${FIXTURE_CSRF_COOKIE}=browser-test` },
      }),
    );
    expect(meWithExistingCsrf?.status).toBe(200);
    expect(meWithExistingCsrf?.headers.getSetCookie()).toEqual([]);

    const switched = api(
      new Request("http://fixture.invalid/api/fixture/persona/owner"),
    );
    expect(switched?.status).toBe(303);
    expect(switched?.headers.getSetCookie()).toEqual([
      `${PERSONA_COOKIE}=owner; Path=/; SameSite=Lax`,
      expectedCsrf,
    ]);

    const csrfHeaders = {
      "content-type": "application/json",
      cookie: `${FIXTURE_CSRF_COOKIE}=${FIXTURE_CSRF_TOKEN}`,
      "x-csrf-token": FIXTURE_CSRF_TOKEN,
    };

    const attach = api(
      new Request("http://fixture.invalid/api/v1/requests/imported/attach", {
        method: "POST",
        headers: csrfHeaders,
        body: JSON.stringify({}),
      }),
    );
    expect(attach?.status).toBe(200);
    expect(AttachImportedRequestsSchema.parse(await attach?.json())).toEqual({
      attached: 0,
    });
    expect(logged).toEqual([]);

    const write = api(
      new Request("http://fixture.invalid/api/v1/requests/movies", {
        method: "POST",
        headers: csrfHeaders,
        body: JSON.stringify({ tmdbId: FEATURED.movie.tmdbId }),
      }),
    );
    expect(write?.status).toBe(501);
    expect(ApiErrorSchema.parse(await write?.json())).toEqual({
      error: {
        code: "fixture_read_only",
        message: "The fixture API is read-only; this change was not saved.",
      },
    });
    expect(logged).toEqual(["refused write: POST /api/v1/requests/movies"]);
  });
});
