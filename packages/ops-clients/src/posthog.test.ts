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
    await expect(client.topPages24h()).rejects.toThrow(/no path column/);
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
});
