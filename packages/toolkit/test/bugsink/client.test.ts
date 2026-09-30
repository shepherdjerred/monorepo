import { afterEach, describe, expect, it } from "vitest";
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
  return input instanceof URL ? input.toString() : input.url;
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

function bugsinkPage(
  results: readonly unknown[],
  next: string | null = null,
): Response {
  return Response.json({
    count: results.length,
    next,
    previous: null,
    results,
  });
}

function issue(id: string) {
  return {
    id,
    project: 42,
    digest_order: 1,
    last_seen: "2026-09-20T00:00:00Z",
    first_seen: "2026-09-19T00:00:00Z",
    digested_event_count: 1,
    stored_event_count: 1,
    calculated_type: "Error",
    calculated_value: `Failure ${id}`,
    transaction: "worker.run",
    is_resolved: false,
    is_resolved_by_next_release: false,
    is_muted: false,
  };
}

function release(id: string, version: string) {
  return {
    id,
    project: 42,
    version,
    date_released: null,
  };
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
      return url.endsWith("/projects/")
        ? bugsinkPage([project()])
        : bugsinkPage([]);
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
      return url.endsWith("/projects/")
        ? bugsinkPage([project()])
        : bugsinkPage([]);
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

describe("Bugsink pagination", () => {
  it("follows issue pagination cursors until next is null", async () => {
    const requestedUrls: string[] = [];
    const page2 =
      "https://bugsink.sjer.red/api/canonical/0/issues/?cursor=page2&project=42";
    installFetchMock(async (input) => {
      const url = fetchInputToUrl(input);
      requestedUrls.push(url);
      return url.includes("cursor=")
        ? bugsinkPage([issue("id-2")])
        : bugsinkPage([issue("id-1")], page2);
    });
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    const issues = await getIssues({ project: "42" });

    expect(issues.map((item) => item.id)).toEqual(["id-1", "id-2"]);
    expect(requestedUrls).toEqual([
      "https://bugsink.sjer.red/api/canonical/0/issues/?project=42",
      page2,
    ]);
  });

  it("treats limit as a client-side cap and stops fetching early", async () => {
    const requestedUrls: string[] = [];
    const page2 =
      "https://bugsink.sjer.red/api/canonical/0/issues/?cursor=page2&project=42";
    installFetchMock(async (input) => {
      const url = fetchInputToUrl(input);
      requestedUrls.push(url);
      return bugsinkPage([issue("id-1"), issue("id-2")], page2);
    });
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    const issues = await getIssues({ project: "42", limit: 1 });

    expect(issues.map((item) => item.id)).toEqual(["id-1"]);
    expect(requestedUrls).toEqual([
      "https://bugsink.sjer.red/api/canonical/0/issues/?project=42",
    ]);
  });

  it("returns no issues and no requests when limit is zero", async () => {
    const requestedUrls: string[] = [];
    installFetchMock(async (input) => {
      requestedUrls.push(fetchInputToUrl(input));
      return bugsinkPage([]);
    });
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    const issues = await getIssues({ project: "42", limit: 0 });

    expect(issues).toEqual([]);
    expect(requestedUrls).toEqual([]);
  });

  it("rejects invalid limits without fetching", async () => {
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    await expect(getIssues({ limit: Number.NaN })).rejects.toThrow(
      "Invalid limit",
    );
    await expect(getIssues({ limit: -1 })).rejects.toThrow("Invalid limit");
  });

  it("surfaces mid-pagination failures with page context", async () => {
    const page2 =
      "https://bugsink.sjer.red/api/canonical/0/issues/?cursor=page2&project=42";
    installFetchMock(async (input) => {
      const url = fetchInputToUrl(input);
      return url.includes("cursor=")
        ? new Response("boom", { status: 500 })
        : bugsinkPage([issue("id-1")], page2);
    });
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    await expect(getIssues({ project: "42" })).rejects.toThrow("(page 2)");
  });

  it("fails loudly on pagination cycles", async () => {
    const page2 =
      "https://bugsink.sjer.red/api/canonical/0/issues/?cursor=page2&project=42";
    installFetchMock(async (input) => {
      const url = fetchInputToUrl(input);
      return url.includes("cursor=")
        ? bugsinkPage([issue("id-2")], page2)
        : bugsinkPage([issue("id-1")], page2);
    });
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    await expect(getIssues({ project: "42" })).rejects.toThrow(
      "pagination cycle",
    );
  });

  it("paginates releases through the shared helper", async () => {
    const requestedUrls: string[] = [];
    const page2 =
      "https://bugsink.sjer.red/api/canonical/0/releases/?cursor=page2&project=42";
    installFetchMock(async (input) => {
      const url = fetchInputToUrl(input);
      requestedUrls.push(url);
      return url.includes("cursor=")
        ? bugsinkPage([release("rel-2", "2.0.0")])
        : bugsinkPage([release("rel-1", "1.0.0")], page2);
    });
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    const releases = await getReleases(42);

    expect(releases.map((item) => item.id)).toEqual(["rel-1", "rel-2"]);
    expect(requestedUrls).toEqual([
      "https://bugsink.sjer.red/api/canonical/0/releases/?project=42",
      page2,
    ]);
  });

  it("fails loudly when maxPages is exceeded and completes when raised", async () => {
    const page2 =
      "https://bugsink.sjer.red/api/canonical/0/issues/?cursor=page2&project=42";
    installFetchMock(async (input) => {
      const url = fetchInputToUrl(input);
      return url.includes("cursor=")
        ? bugsinkPage([issue("id-2")])
        : bugsinkPage([issue("id-1")], page2);
    });
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    await expect(getIssues({ project: "42", maxPages: 1 })).rejects.toThrow(
      "exceeded 1 page",
    );
    const issues = await getIssues({ project: "42", maxPages: 2 });
    expect(issues.map((item) => item.id)).toEqual(["id-1", "id-2"]);
  });

  it("rejects invalid maxPages", async () => {
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    await expect(getIssues({ maxPages: Number.NaN })).rejects.toThrow(
      "Invalid maxPages",
    );
    await expect(getIssues({ maxPages: 0 })).rejects.toThrow(
      "Invalid maxPages",
    );
  });

  it("refuses pagination URLs on another origin without fetching them", async () => {
    const requestedUrls: string[] = [];
    installFetchMock(async (input) => {
      const url = fetchInputToUrl(input);
      requestedUrls.push(url);
      return bugsinkPage(
        [issue("id-1")],
        "https://evil.example.test/api/canonical/0/issues/?cursor=x",
      );
    });
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    await expect(getIssues({ project: "42" })).rejects.toThrow(
      "unexpected origin",
    );
    expect(requestedUrls).toEqual([
      "https://bugsink.sjer.red/api/canonical/0/issues/?project=42",
    ]);
  });

  it("returns no requests for zero limit even with a slug filter", async () => {
    const requestedUrls: string[] = [];
    installFetchMock(async (input) => {
      requestedUrls.push(fetchInputToUrl(input));
      return bugsinkPage([project()]);
    });
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    const issues = await getIssues({ project: "scout-for-lol", limit: 0 });

    expect(issues).toEqual([]);
    expect(requestedUrls).toEqual([]);
  });

  it("threads maxPages through release listing", async () => {
    const page2 =
      "https://bugsink.sjer.red/api/canonical/0/releases/?cursor=page2&project=42";
    installFetchMock(async (input) => {
      const url = fetchInputToUrl(input);
      return url.includes("cursor=")
        ? bugsinkPage([release("rel-2", "2.0.0")])
        : bugsinkPage([release("rel-1", "1.0.0")], page2);
    });
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    await expect(getReleases(42, { maxPages: 1 })).rejects.toThrow(
      "higher maxPages",
    );
  });
});
