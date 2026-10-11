import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ConditionalCache,
  GitHubRateLimitError,
  githubGet,
  rateLimitError,
} from "./github-request.ts";
import { getJsonWithLink, graphqlRequest } from "./github-http.ts";

const URL_A = "https://api.github.com/repos/o/r/pulls/1/reviews?per_page=100";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Call = { url: string; ifNoneMatch: string | null };

function stubFetch(responses: (() => Response)[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      calls.push({ url, ifNoneMatch: headers.get("if-none-match") });
      const next = responses.shift();
      if (next === undefined) throw new Error("unexpected fetch");
      return next();
    }),
  );
  return calls;
}

function etagged(body: unknown, etag: string, link?: string): Response {
  return Response.json(body, {
    headers: { etag, ...(link === undefined ? {} : { link }) },
  });
}

describe("githubGet", () => {
  test("revalidates a stored ETag and replays the cached body on 304", async () => {
    const calls = stubFetch([
      () => etagged([{ id: 1 }], 'W/"one"'),
      () => new Response(null, { status: 304 }),
    ]);
    const cache = new ConditionalCache();

    const first = await githubGet(URL_A, { token: "t", cache });
    expect(await first.json()).toEqual([{ id: 1 }]);
    const second = await githubGet(URL_A, { token: "t", cache });

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual([{ id: 1 }]);
    expect(calls.map((call) => call.ifNoneMatch)).toEqual([null, 'W/"one"']);
    expect(cache.notModified).toBe(1);
    expect(cache.fetched).toBe(1);
  });

  test("stores the new body when the resource changed", async () => {
    stubFetch([
      () => etagged([{ id: 1 }], '"one"'),
      () => etagged([{ id: 1 }, { id: 2 }], '"two"'),
      () => new Response(null, { status: 304 }),
    ]);
    const cache = new ConditionalCache();

    await githubGet(URL_A, { token: "t", cache });
    await githubGet(URL_A, { token: "t", cache });
    const third = await githubGet(URL_A, { token: "t", cache });

    expect(await third.json()).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("keeps tokens and query strings in separate entries", async () => {
    const calls = stubFetch([
      () => etagged([], '"a"'),
      () => etagged([], '"b"'),
      () => etagged([], '"c"'),
    ]);
    const cache = new ConditionalCache();

    await githubGet(URL_A, { token: "one", cache });
    await githubGet(URL_A, { token: "two", cache });
    await githubGet(`${URL_A}&page=2`, { token: "one", cache });

    expect(calls.map((call) => call.ifNoneMatch)).toEqual([null, null, null]);
    expect(cache.size).toBe(3);
  });

  test("evicts the least recently used entry past its bound", async () => {
    stubFetch([
      () => etagged([], '"a"'),
      () => etagged([], '"b"'),
      () => new Response(null, { status: 304 }),
      () => etagged([], '"c"'),
    ]);
    const cache = new ConditionalCache(2);

    await githubGet("https://api.github.com/a", { token: "t", cache });
    await githubGet("https://api.github.com/b", { token: "t", cache });
    await githubGet("https://api.github.com/a", { token: "t", cache });
    await githubGet("https://api.github.com/c", { token: "t", cache });

    expect(cache.size).toBe(2);
  });

  test("returns other failures unchanged for the caller to report", async () => {
    stubFetch([() => new Response("Not Found", { status: 404 })]);

    const response = await githubGet(URL_A, {
      token: "t",
      cache: new ConditionalCache(),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  test("throws a typed error for an exhausted primary bucket", async () => {
    stubFetch([
      () =>
        new Response('{"message":"API rate limit exceeded for user ID 1."}', {
          status: 403,
          headers: {
            "x-ratelimit-limit": "5000",
            "x-ratelimit-used": "5000",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "4102444800",
            "x-ratelimit-resource": "core",
          },
        }),
    ]);

    let failure: unknown = null;
    try {
      await githubGet(URL_A, { token: "t" });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(GitHubRateLimitError);
    if (!(failure instanceof GitHubRateLimitError)) return;
    expect(failure.details).toMatchObject({
      resource: "core",
      limit: 5000,
      used: 5000,
      remaining: 0,
    });
    expect(failure.resumeAt).toBe(4_102_444_800_000);
    expect(failure.message).toContain(
      "core rate limit exceeded (used 5000/5000)",
    );
    expect(failure.message).toContain("/repos/o/r/pulls/1/reviews");
    expect(failure.message).toContain("2100-01-01T00:00:00.000Z");
  });

  test("keeps a permission 403 as an ordinary response", async () => {
    stubFetch([
      () =>
        new Response('{"message":"Resource not accessible by integration"}', {
          status: 403,
          headers: { "x-ratelimit-remaining": "4000" },
        }),
    ]);

    const response = await githubGet(URL_A, { token: "t" });

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("not accessible");
  });
});

describe("rateLimitError", () => {
  test("honours retry-after for a secondary limit", () => {
    const error = rateLimitError(
      new Response("", {
        status: 403,
        headers: { "retry-after": "30", "x-ratelimit-remaining": "12" },
      }),
      "You have exceeded a secondary rate limit.",
      "/x",
    );

    expect(error).not.toBeNull();
    expect(error?.details.retryAfterSeconds).toBe(30);
  });

  test("backs off a minute for a secondary limit without guidance", () => {
    const now = Date.UTC(2026, 9, 11, 21, 0, 0);
    const limited = rateLimitError(
      new Response("", { status: 403 }),
      "You have exceeded a secondary rate limit.",
      "/x",
    );
    expect(limited).not.toBeNull();
    if (limited === null) return;
    const rebuilt = new GitHubRateLimitError("/x", limited.details, now);

    expect(rebuilt.resumeAt).toBe(now + 60_000);
  });

  test("treats every 429 as a rate limit", () => {
    expect(
      rateLimitError(new Response("", { status: 429 }), "", "/x"),
    ).toBeInstanceOf(GitHubRateLimitError);
  });
});

describe("getJsonWithLink", () => {
  test("preserves pagination links through a 304", async () => {
    const url =
      "https://api.github.com/repos/o/r/issues/9/comments?per_page=100";
    const next = `${url}&page=2`;
    stubFetch([
      () => etagged([{ id: 1 }], '"p1"', `<${next}>; rel="next"`),
      () => new Response(null, { status: 304 }),
    ]);

    await getJsonWithLink(url, "link-token");
    const replayed = await getJsonWithLink(url, "link-token");

    expect(replayed).toEqual({ payload: [{ id: 1 }], linkNext: next });
  });
});

describe("graphqlRequest", () => {
  test("raises the typed error for a rate limit reported with HTTP 200", async () => {
    stubFetch([
      () =>
        Response.json(
          { errors: [{ type: "RATE_LIMITED", message: "API rate limit" }] },
          {
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": "4102444800",
              "x-ratelimit-resource": "graphql",
            },
          },
        ),
    ]);

    let failure: unknown = null;
    try {
      await graphqlRequest("query { viewer { login } }", {}, "t");
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(GitHubRateLimitError);
  });

  test("keeps other GraphQL errors as ordinary failures", async () => {
    stubFetch([
      () =>
        Response.json(
          { errors: [{ type: "NOT_FOUND", message: "missing" }] },
          { headers: { "x-ratelimit-remaining": "4000" } },
        ),
    ]);

    await expect(
      graphqlRequest("query { viewer { login } }", {}, "t"),
    ).rejects.toThrow("GraphQL returned errors");
  });
});
