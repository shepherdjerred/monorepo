import { describe, expect, test } from "vitest";
import {
  BugsinkClient,
  bugsinkIssueUrl,
  bugsinkProjectUrl,
} from "@shepherdjerred/ops-clients/bugsink.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

const BASE = "https://bugsink.sjer.red";

function issue(
  id: string,
  resolved: boolean,
  overrides: {
    project?: number;
    last_seen?: string;
    digested_event_count?: number;
    is_muted?: boolean;
  } = {},
) {
  return {
    id,
    project: overrides.project ?? 3,
    digest_order: 1,
    first_seen: "2026-09-20T10:00:00Z",
    last_seen: overrides.last_seen ?? "2026-09-24T11:00:00Z",
    digested_event_count: overrides.digested_event_count ?? 4,
    stored_event_count: 4,
    calculated_type: "TypeError",
    calculated_value: `err-${id}`,
    transaction: "GET /",
    is_resolved: resolved,
    is_resolved_by_next_release: false,
    is_muted: overrides.is_muted ?? false,
  };
}

describe("BugsinkClient", () => {
  test("follows every page and keeps unresolved issues", async () => {
    const { fetch, requests } = sequence(
      {
        next: `${BASE}/api/canonical/0/issues/?cursor=2&project=3`,
        previous: null,
        results: [issue("a", false), issue("b", true)],
      },
      { next: null, previous: null, results: [issue("c", false)] },
    );
    const client = new BugsinkClient({ baseUrl: BASE, token: "t", fetch });
    const issues = await client.unresolvedIssues(3);
    expect(issues.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(requests[0]?.url).toBe(`${BASE}/api/canonical/0/issues/?project=3`);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer t");
  });

  test("exposes optional project event counts and computes allProjectsSummary with bounded concurrency", async () => {
    const now = new Date("2026-09-24T12:00:00Z");
    let inFlight = 0;
    let maxInFlight = 0;

    const projectsPayload = {
      next: null,
      results: [
        {
          id: 1,
          name: "Scout",
          slug: "scout",
          digested_event_count: 500,
          stored_event_count: 100,
        },
        { id: 2, name: "Hub", slug: "hub" },
        { id: 3, name: "Birmel", slug: "birmel" },
        { id: 4, name: "Tracker", slug: "tracker" },
        { id: 5, name: "Golink", slug: "golink" },
        { id: 6, name: "Docs", slug: "docs" },
      ],
    };

    const issuesByProject: Record<string, unknown[]> = {
      "1": [
        issue("recent-low", false, {
          project: 1,
          last_seen: "2026-09-24T11:30:00Z",
          digested_event_count: 5,
        }),
        issue("recent-high", false, {
          project: 1,
          last_seen: "2026-09-23T00:00:00Z",
          digested_event_count: 42,
        }),
        issue("stale-one", false, {
          project: 1,
          last_seen: "2026-09-01T00:00:00Z",
          digested_event_count: 10,
        }),
        issue("muted-one", false, {
          project: 1,
          last_seen: "2026-09-24T11:00:00Z",
          digested_event_count: 99,
          is_muted: true,
        }),
      ],
      "2": [
        issue("hub-1", false, {
          project: 2,
          last_seen: "2026-09-24T09:00:00Z",
          digested_event_count: 7,
        }),
      ],
    };

    const client = new BugsinkClient({
      baseUrl: BASE,
      token: "t",
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/projects/")) {
          return Response.json(projectsPayload);
        }
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        const proj = url.searchParams.get("project") ?? "";
        return Response.json({
          next: null,
          results: issuesByProject[proj] ?? [],
        });
      },
    });

    const summaries = await client.allProjectsSummary(now);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(summaries).toHaveLength(6);
    expect(summaries[0]).toMatchObject({
      project: {
        id: 1,
        name: "Scout",
        slug: "scout",
        digested_event_count: 500,
        stored_event_count: 100,
      },
      activeIssues7d: 2,
      staleIssues: 1,
      mutedIssues: 1,
      digestedEventsTotal: 500,
    });
    expect(summaries[0]?.topIssues.map((i) => i.id)).toEqual([
      "recent-high",
      "stale-one",
      "recent-low",
    ]);
    expect(summaries[1]).toMatchObject({
      project: { id: 2, name: "Hub", slug: "hub" },
      activeIssues7d: 1,
      staleIssues: 0,
      mutedIssues: 0,
      digestedEventsTotal: 7,
    });
  });

  test("refuses a pagination link on another origin", async () => {
    const { fetch } = sequence({
      next: "https://evil.example/api/canonical/0/projects/?cursor=2",
      results: [],
    });
    const client = new BugsinkClient({ baseUrl: BASE, token: "t", fetch });
    await expect(client.projects()).rejects.toThrow(/refusing pagination/u);
  });

  test("refuses a repeated cursor", async () => {
    const page = {
      next: `${BASE}/api/canonical/0/projects/?cursor=2`,
      results: [{ id: 1, name: "Scout", slug: "scout-for-lol" }],
    };
    const { fetch } = sequence(page, page, page);
    const client = new BugsinkClient({ baseUrl: BASE, token: "t", fetch });
    await expect(client.projects()).rejects.toThrow(/refusing pagination/u);
  });

  test("builds web UI links", () => {
    expect(bugsinkIssueUrl(BASE, "abc")).toBe(
      `${BASE}/issues/issue/abc/event/last/`,
    );
    expect(bugsinkProjectUrl(BASE, 3)).toBe(`${BASE}/issues/3/`);
  });
});
