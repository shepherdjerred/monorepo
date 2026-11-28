import { describe, expect, test } from "vitest";
import {
  BugsinkClient,
  bugsinkIssueUrl,
  bugsinkProjectUrl,
} from "@shepherdjerred/ops-clients/bugsink.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

const BASE = "https://errors.tailnet-1a49.ts.net";

function issue(
  id: string,
  state: "OPEN" | "RESOLVED" | "RESOLVED_NEXT_RELEASE" | "MUTED",
  overrides: {
    projectId?: number;
    lastSeen?: string;
    digestedEventCount?: number;
  } = {},
) {
  return {
    id,
    projectId: overrides.projectId ?? 3,
    firstSeen: "2026-09-20T10:00:00Z",
    lastSeen: overrides.lastSeen ?? "2026-09-24T11:00:00Z",
    digestedEventCount: overrides.digestedEventCount ?? 4,
    storedEventCount: 4,
    type: "TypeError",
    value: `err-${id}`,
    transaction: "GET /",
    state,
  };
}

describe("BugsinkClient", () => {
  test("follows cursor pages and keeps unresolved and muted issues", async () => {
    const { fetch, requests } = sequence(
      {
        nextCursor: "b",
        items: [issue("a", "OPEN"), issue("b", "RESOLVED")],
      },
      {
        nextCursor: null,
        items: [issue("c", "MUTED")],
      },
    );
    const client = new BugsinkClient({ baseUrl: BASE, fetch });
    const issues = await client.unresolvedIssues(3);
    expect(issues.map((entry) => [entry.id, entry.muted])).toEqual([
      ["a", false],
      ["c", true],
    ]);
    expect(requests[0]?.url).toBe(
      `${BASE}/api/v1/issues?project=3&tab=all&limit=200`,
    );
    expect(requests[1]?.url).toBe(
      `${BASE}/api/v1/issues?project=3&tab=all&limit=200&cursor=b`,
    );
  });

  test("maps project event counts and computes allProjectsSummary with bounded concurrency", async () => {
    const now = new Date("2026-09-24T12:00:00Z");
    let inFlight = 0;
    let maxInFlight = 0;

    const projectsPayload = {
      items: [
        {
          id: 1,
          name: "Scout",
          slug: "scout",
          digestedEventCount: 500,
          storedEventCount: 100,
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
        issue("recent-low", "OPEN", {
          projectId: 1,
          lastSeen: "2026-09-24T11:30:00Z",
          digestedEventCount: 5,
        }),
        issue("recent-high", "OPEN", {
          projectId: 1,
          lastSeen: "2026-09-23T00:00:00Z",
          digestedEventCount: 42,
        }),
        issue("stale-one", "OPEN", {
          projectId: 1,
          lastSeen: "2026-09-01T00:00:00Z",
          digestedEventCount: 10,
        }),
        issue("muted-one", "MUTED", {
          projectId: 1,
          lastSeen: "2026-09-24T11:00:00Z",
          digestedEventCount: 99,
        }),
      ],
      "2": [
        issue("hub-1", "OPEN", {
          projectId: 2,
          lastSeen: "2026-09-24T09:00:00Z",
          digestedEventCount: 7,
        }),
      ],
    };

    const client = new BugsinkClient({
      baseUrl: BASE,
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/projects")) {
          return Response.json(projectsPayload);
        }
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        const proj = url.searchParams.get("project") ?? "";
        return Response.json({
          nextCursor: null,
          items: issuesByProject[proj] ?? [],
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

  test("refuses a repeated cursor", async () => {
    const page = {
      nextCursor: "same-cursor",
      items: [issue("a", "OPEN")],
    };
    const { fetch } = sequence(page, page, page);
    const client = new BugsinkClient({ baseUrl: BASE, fetch });
    await expect(client.unresolvedIssues(3)).rejects.toThrow(
      /refusing repeated cursor/u,
    );
  });

  test("builds Errors console deep links", () => {
    expect(bugsinkIssueUrl(BASE, "abc")).toBe(`${BASE}/issues/abc`);
    expect(bugsinkProjectUrl(BASE, "scout-for-lol")).toBe(
      `${BASE}/projects/scout-for-lol`,
    );
    expect(bugsinkProjectUrl(BASE, 3)).toBe(`${BASE}/issues/3`);
  });
});
