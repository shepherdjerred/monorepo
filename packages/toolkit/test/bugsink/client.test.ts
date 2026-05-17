import { afterEach, describe, expect, it } from "bun:test";
import { buildBugsinkApiUrl } from "#lib/bugsink/client.ts";
import { getIssues } from "#lib/bugsink/issues.ts";
import { getReleases } from "#lib/bugsink/queries.ts";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_URL = Bun.env["BUGSINK_URL"];
const ORIGINAL_TOKEN = Bun.env["BUGSINK_TOKEN"];

type FetchInput = Parameters<typeof fetch>[0];

function installFetchMock(
  handler: (input: FetchInput) => Promise<Response>,
): void {
  const fetchMock: typeof fetch = Object.assign(
    async (input: FetchInput) => handler(input),
    { preconnect: ORIGINAL_FETCH.preconnect },
  );
  globalThis.fetch = fetchMock;
}

function fetchInputToUrl(input: FetchInput): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_URL === undefined) {
    Reflect.deleteProperty(Bun.env, "BUGSINK_URL");
  } else {
    Bun.env["BUGSINK_URL"] = ORIGINAL_URL;
  }
  if (ORIGINAL_TOKEN === undefined) {
    Reflect.deleteProperty(Bun.env, "BUGSINK_TOKEN");
  } else {
    Bun.env["BUGSINK_TOKEN"] = ORIGINAL_TOKEN;
  }
});

function bugsinkPage(results: readonly unknown[]): Response {
  return Response.json({
    count: results.length,
    next: null,
    previous: null,
    results,
  });
}

function project() {
  return {
    id: 42,
    team: null,
    name: "Scout",
    slug: "scout-for-lol",
    dsn: "https://dsn.example.test/42",
    digested_event_count: 10,
    stored_event_count: 2,
    visibility: "team_members",
    alert_on_new_issue: true,
    alert_on_regression: true,
    alert_on_unmute: true,
  };
}

describe("Bugsink client", () => {
  it("normalizes BUGSINK_URL when the canonical API prefix is already present", () => {
    const url = buildBugsinkApiUrl(
      "https://bugsink.sjer.red/api/canonical/0",
      "/projects/",
    );

    expect(url.toString()).toBe(
      "https://bugsink.sjer.red/api/canonical/0/projects/",
    );
  });

  it("resolves issue project slugs to Bugsink project ids", async () => {
    const requestedUrls: string[] = [];
    installFetchMock(async (input) => {
      const url = fetchInputToUrl(input);
      requestedUrls.push(url);
      if (url.endsWith("/projects/")) {
        return bugsinkPage([project()]);
      }
      return bugsinkPage([]);
    });
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    await getIssues({ project: "scout-for-lol" });

    expect(requestedUrls).toEqual([
      "https://bugsink.sjer.red/api/canonical/0/projects/",
      "https://bugsink.sjer.red/api/canonical/0/issues/?project=42",
    ]);
  });

  it("resolves release project slugs to Bugsink project ids", async () => {
    const requestedUrls: string[] = [];
    installFetchMock(async (input) => {
      const url = fetchInputToUrl(input);
      requestedUrls.push(url);
      if (url.endsWith("/projects/")) {
        return bugsinkPage([project()]);
      }
      return bugsinkPage([]);
    });
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    await getReleases("scout-for-lol");

    expect(requestedUrls).toEqual([
      "https://bugsink.sjer.red/api/canonical/0/projects/",
      "https://bugsink.sjer.red/api/canonical/0/releases/?project=42",
    ]);
  });
});
