import { describe, expect, test } from "vitest";
import { PostHogClient } from "@shepherdjerred/ops-clients/posthog.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

describe("PostHogClient", () => {
  test("posts HogQL and reads rows by column name", async () => {
    const { fetch, requests } = sequence({
      columns: ["site_key", "host", "pageviews"],
      results: [
        ["scout-prod", "scout-for-lol.com", 120],
        [null, "unknown.example", 3],
      ],
    });
    const client = new PostHogClient({ apiKey: "phx_key", fetch });
    await expect(client.pageviewsByHost24h()).resolves.toEqual([
      { siteKey: "scout-prod", host: "scout-for-lol.com", pageviews: 120 },
      { siteKey: undefined, host: "unknown.example", pageviews: 3 },
    ]);
    expect(requests[0]?.url).toBe(
      "https://us.posthog.com/api/projects/549883/query",
    );
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer phx_key");
    expect(requests[0]?.body).toMatchObject({ query: { kind: "HogQLQuery" } });
  });

  test("a missing column is a broken contract", async () => {
    const { fetch } = sequence({ columns: ["host"], results: [] });
    const client = new PostHogClient({ apiKey: "k", fetch });
    await expect(client.topPages24h()).rejects.toThrow(/no path column/u);
  });

  test("reads top pages", async () => {
    const { fetch } = sequence({
      columns: ["host", "path", "pageviews"],
      results: [["sjer.red", "/", 40]],
    });
    const client = new PostHogClient({ apiKey: "k", fetch });
    await expect(client.topPages24h()).resolves.toEqual([
      { host: "sjer.red", path: "/", pageviews: 40 },
    ]);
  });

  test("siteTrafficSummary zero-fills missing UTC days across 7-day window", async () => {
    const now = new Date("2026-09-24T15:00:00Z");
    const { fetch } = sequence({
      columns: [
        "site_key",
        "host",
        "day",
        "pageviews",
        "pageviews_24h",
        "dau_24h",
        "wau_7d",
        "exceptions_24h",
        "rageclicks_24h",
      ],
      results: [
        ["scout-prod", "scout-for-lol.com", "2026-09-18", 10, 50, 12, 85, 2, 1],
        ["scout-prod", "scout-for-lol.com", "2026-09-21", 25, 50, 12, 85, 2, 1],
        ["scout-prod", "scout-for-lol.com", "2026-09-24", 40, 50, 12, 85, 2, 1],
        ["", "sjer.red", "2026-09-24", 5, 5, 3, 9, 0, 0],
      ],
    });
    const client = new PostHogClient({ apiKey: "k", fetch });
    await expect(client.siteTrafficSummary(now)).resolves.toEqual([
      {
        siteKey: "scout-prod",
        host: "scout-for-lol.com",
        pageviews24h: 50,
        dau24h: 12,
        wau7d: 85,
        dailySeries7d: [10, 0, 0, 25, 0, 0, 40],
        exceptions24h: 2,
        rageclicks24h: 1,
      },
      {
        siteKey: undefined,
        host: "sjer.red",
        pageviews24h: 5,
        dau24h: 3,
        wau7d: 9,
        dailySeries7d: [0, 0, 0, 0, 0, 0, 5],
        exceptions24h: 0,
        rageclicks24h: 0,
      },
    ]);
  });

  test("webVitalsByHost24h reads p75 LCP and INP and tolerates null INP", async () => {
    const { fetch, requests } = sequence({
      columns: ["host", "lcp_p75", "inp_p75", "samples"],
      results: [
        ["scout-for-lol.com", 1420.5, 96, 300],
        ["sjer.red", 850, null, 12],
      ],
    });
    const client = new PostHogClient({ apiKey: "k", fetch });
    await expect(client.webVitalsByHost24h()).resolves.toEqual([
      { host: "scout-for-lol.com", lcpP75: 1420.5, inpP75: 96, samples: 300 },
      { host: "sjer.red", lcpP75: 850, inpP75: null, samples: 12 },
    ]);
    expect(JSON.stringify(requests[0]?.body)).toContain(
      "$web_vitals_LCP_value",
    );
    expect(JSON.stringify(requests[0]?.body)).toContain(
      "$web_vitals_INP_value",
    );
  });

  test("topReferrers24h reads external referring domains", async () => {
    const { fetch, requests } = sequence({
      columns: ["referring_domain", "count"],
      results: [
        ["github.com", 44],
        ["reddit.com", 19],
      ],
    });
    const client = new PostHogClient({ apiKey: "k", fetch });
    await expect(client.topReferrers24h()).resolves.toEqual([
      { domain: "github.com", count: 44 },
      { domain: "reddit.com", count: 19 },
    ]);
    expect(JSON.stringify(requests[0]?.body)).toContain("$direct");
  });

  test("eventCountsWindow fetches funnel events in one query and zero-fills absent events", async () => {
    const { fetch, requests } = sequence({
      columns: ["event", "count_24h", "count_7d"],
      results: [["scout_match_reported", 14, 98]],
    });
    const client = new PostHogClient({ apiKey: "k", fetch });
    await expect(client.eventCountsWindow([])).resolves.toEqual([]);
    expect(requests).toHaveLength(0);

    await expect(
      client.eventCountsWindow([
        "scout_match_reported",
        "storm_player_joined",
        "scout_match_reported",
      ]),
    ).resolves.toEqual([
      { event: "scout_match_reported", count24h: 14, count7d: 98 },
      { event: "storm_player_joined", count24h: 0, count7d: 0 },
    ]);
    expect(requests).toHaveLength(1);
  });
});
