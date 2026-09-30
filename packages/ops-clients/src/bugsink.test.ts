import { describe, expect, test } from "vitest";
import {
  BugsinkClient,
  bugsinkIssueUrl,
  bugsinkProjectUrl,
} from "@shepherdjerred/ops-clients/bugsink.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

const BASE = "https://bugsink.sjer.red";

function issue(id: string, resolved: boolean) {
  return {
    id,
    project: 3,
    digest_order: 1,
    first_seen: "2026-09-24T10:00:00Z",
    last_seen: "2026-09-24T11:00:00Z",
    digested_event_count: 4,
    stored_event_count: 4,
    calculated_type: "TypeError",
    calculated_value: "x is undefined",
    transaction: "GET /",
    is_resolved: resolved,
    is_resolved_by_next_release: false,
    is_muted: false,
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

  test("refuses a pagination link on another origin", async () => {
    const { fetch } = sequence({
      next: "https://evil.example/api/canonical/0/projects/?cursor=2",
      results: [],
    });
    const client = new BugsinkClient({ baseUrl: BASE, token: "t", fetch });
    await expect(client.projects()).rejects.toThrow(/refusing pagination/);
  });

  test("refuses a repeated cursor", async () => {
    const page = {
      next: `${BASE}/api/canonical/0/projects/?cursor=2`,
      results: [{ id: 1, name: "Scout", slug: "scout-for-lol" }],
    };
    const { fetch } = sequence(page, page, page);
    const client = new BugsinkClient({ baseUrl: BASE, token: "t", fetch });
    await expect(client.projects()).rejects.toThrow(/refusing pagination/);
  });

  test("builds web UI links", () => {
    expect(bugsinkIssueUrl(BASE, "abc")).toBe(
      `${BASE}/issues/issue/abc/event/last/`,
    );
    expect(bugsinkProjectUrl(BASE, 3)).toBe(`${BASE}/issues/3/`);
  });
});
