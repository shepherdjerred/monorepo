import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBugsinkApiUrl } from "#lib/bugsink/client.ts";
import { getIssues } from "#lib/bugsink/issues.ts";
import { getEvents, getReleases } from "#lib/bugsink/queries.ts";
import { handleBugsinkCommand } from "#handlers/bugsink.ts";

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
  vi.restoreAllMocks();
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

function issue(
  id: string,
  overrides: {
    project?: number;
    is_resolved?: boolean;
    is_muted?: boolean;
  } = {},
) {
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
    ...overrides,
  };
}

function event(id: string) {
  return {
    id,
    ingested_at: "2026-09-20T00:00:00Z",
    digested_at: "2026-09-20T00:00:00Z",
    issue: "issue-1",
    grouping: 1,
    event_id: `event-${id}`,
    project: 42,
    timestamp: "2026-09-20T00:00:00Z",
    digest_order: 1,
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

function project(id = 42, slug = "scout-for-lol") {
  return {
    id,
    team: null,
    name: "Scout",
    slug,
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

function installIssuesByProject(
  issuesByProject: Record<string, readonly unknown[]>,
): string[] {
  const requestedUrls: string[] = [];
  installFetchMock(async (input) => {
    const url = fetchInputToUrl(input);
    requestedUrls.push(url);
    if (url.endsWith("/projects/")) {
      return bugsinkPage([project(42, "scout"), project(7, "temporal")]);
    }
    const projectId = new URL(url).searchParams.get("project") ?? "";
    return bugsinkPage(issuesByProject[projectId] ?? []);
  });
  Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
  Bun.env["BUGSINK_TOKEN"] = "token";
  return requestedUrls;
}

describe("Bugsink issue listing", () => {
  const issuesByProject = {
    "42": [
      issue("open-42"),
      issue("resolved-42", { is_resolved: true }),
      issue("muted-42", { is_muted: true }),
    ],
    "7": [issue("open-7", { project: 7 })],
  };

  it("lists every project's open issues when no project is given", async () => {
    const requestedUrls = installIssuesByProject(issuesByProject);

    const issues = await getIssues();

    expect(issues.map((item) => item.id)).toEqual(["open-42", "open-7"]);
    expect(requestedUrls).toEqual([
      "https://bugsink.sjer.red/api/canonical/0/projects/",
      "https://bugsink.sjer.red/api/canonical/0/issues/?project=42",
      "https://bugsink.sjer.red/api/canonical/0/issues/?project=7",
    ]);
  });

  it("includes resolved and muted issues with all", async () => {
    installIssuesByProject(issuesByProject);

    const issues = await getIssues({ all: true });

    expect(issues.map((item) => item.id)).toEqual([
      "open-42",
      "resolved-42",
      "muted-42",
      "open-7",
    ]);
  });

  it("counts only open issues toward the limit and stops at it", async () => {
    const requestedUrls = installIssuesByProject(issuesByProject);

    const issues = await getIssues({ limit: 1 });

    expect(issues.map((item) => item.id)).toEqual(["open-42"]);
    expect(requestedUrls).toEqual([
      "https://bugsink.sjer.red/api/canonical/0/projects/",
      "https://bugsink.sjer.red/api/canonical/0/issues/?project=42",
    ]);
  });

  it("filters a single project's resolved issues by default", async () => {
    installIssuesByProject(issuesByProject);

    const issues = await getIssues({ project: "42" });

    expect(issues.map((item) => item.id)).toEqual(["open-42"]);
  });
});

describe("Bugsink event listing", () => {
  it("caps events with limit and stops paginating", async () => {
    const requestedUrls: string[] = [];
    const page2 =
      "https://bugsink.sjer.red/api/canonical/0/events/?cursor=page2&issue=issue-1";
    installFetchMock(async (input) => {
      const url = fetchInputToUrl(input);
      requestedUrls.push(url);
      return bugsinkPage([event("e1"), event("e2")], page2);
    });
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";

    const events = await getEvents("issue-1", { limit: 1 });

    expect(events.map((item) => item.id)).toEqual(["e1"]);
    expect(requestedUrls).toEqual([
      "https://bugsink.sjer.red/api/canonical/0/events/?issue=issue-1",
    ]);
  });

  it("accepts --limit on the events subcommand", async () => {
    installFetchMock(async () => bugsinkPage([event("e1"), event("e2")]));
    Bun.env["BUGSINK_URL"] = "https://bugsink.sjer.red";
    Bun.env["BUGSINK_TOKEN"] = "token";
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      output.push(String(line));
    });

    await handleBugsinkCommand("events", ["issue-1", "--limit", "1", "--json"]);

    const printed: unknown = JSON.parse(output.join("\n"));
    expect(printed).toEqual([event("e1")]);
  });
});
