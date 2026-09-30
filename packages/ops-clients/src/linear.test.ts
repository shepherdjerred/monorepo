import { describe, expect, test } from "vitest";
import { LinearClient } from "@shepherdjerred/ops-clients/linear.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

function issue(identifier: string, team: string, type: string) {
  return {
    id: `id-${identifier}`,
    identifier,
    title: `Issue ${identifier}`,
    url: `https://linear.app/sjerred/issue/${identifier}`,
    createdAt: "2026-09-24T00:00:00Z",
    team: { key: team },
    state: { type },
  };
}

describe("LinearClient", () => {
  test("groups open issues, lists triage, and reads active cycles", async () => {
    const { fetch, requests } = sequence(
      {
        data: {
          issues: {
            pageInfo: { hasNextPage: true, endCursor: "p2" },
            nodes: [
              issue("SJ-1", "SJ", "triage"),
              issue("AI-1", "AI", "started"),
            ],
          },
        },
      },
      {
        data: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [issue("AI-2", "AI", "started")],
          },
        },
      },
      {
        data: {
          teams: {
            nodes: [
              {
                key: "AI",
                name: "AI",
                activeCycle: {
                  number: 12,
                  startsAt: "2026-09-21T00:00:00Z",
                  endsAt: "2026-10-05T00:00:00Z",
                  progress: 0.4,
                },
              },
              { key: "SJ", name: "Jerred", activeCycle: null },
            ],
          },
        },
      },
    );
    const client = new LinearClient({ apiKey: "lin_api_key", fetch });
    const overview = await client.overview();
    expect(overview.counts).toEqual({ SJ: { triage: 1 }, AI: { started: 2 } });
    expect(overview.triage.map((entry) => entry.identifier)).toEqual(["SJ-1"]);
    expect(overview.cycles).toEqual([
      {
        team: "AI",
        teamName: "AI",
        number: 12,
        startsAt: "2026-09-21T00:00:00Z",
        endsAt: "2026-10-05T00:00:00Z",
        progress: 0.4,
      },
    ]);
    // Personal API keys are sent without a Bearer scheme.
    expect(requests[0]?.headers.get("authorization")).toBe("lin_api_key");
    expect(requests[0]?.url).toBe("https://api.linear.app/graphql");
  });

  test("accepts Linear's duplicate state type and excludes it from open issues", async () => {
    const { fetch, requests } = sequence({
      data: {
        issues: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [issue("SJ-2", "SJ", "duplicate")],
        },
      },
    });
    const client = new LinearClient({ apiKey: "k", fetch });
    await expect(client.openIssues()).resolves.toBeDefined();
    expect(JSON.stringify(requests)).toContain("duplicate");
  });

  test("an unknown state type fails loudly", async () => {
    const { fetch } = sequence({
      data: {
        issues: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [issue("SJ-1", "SJ", "someday")],
        },
      },
    });
    const client = new LinearClient({ apiKey: "k", fetch });
    await expect(client.openIssues()).rejects.toThrow(/^linear: /);
  });
});
