import { describe, expect, test } from "vitest";
import {
  DEFAULT_ACCOUNT,
  fetchAnthropicBilling,
  fetchOpenAiBilling,
  type BillingFetch,
} from "./llm-billing.ts";

// 2026-09-24T15:00:00Z; the UTC day starts at 2026-09-24T00:00:00Z.
const NOW = new Date("2026-09-24T15:00:00Z");
const TODAY = Math.floor(Date.UTC(2026, 8, 24) / 1000);
const YESTERDAY = TODAY - 86_400;

function router(routes: Record<string, (url: URL) => unknown>): {
  fetcher: BillingFetch;
  seen: URL[];
} {
  const seen: URL[] = [];
  const fetcher: BillingFetch = (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    seen.push(url);
    const handler = routes[url.pathname];
    return Promise.resolve(
      handler === undefined
        ? new Response("not found", { status: 404 })
        : Response.json(handler(url)),
    );
  };
  return { fetcher, seen };
}

describe("OpenAI billed cost", () => {
  test("splits today from the trailing week and names each project", async () => {
    const { fetcher, seen } = router({
      "/v1/organization/projects": () => ({
        data: [
          { id: "proj_birmel", name: "Birmel" },
          { id: "proj_scout", name: "Scout for LoL" },
        ],
        has_more: false,
      }),
      "/v1/organization/costs": () => ({
        data: [
          {
            start_time: YESTERDAY,
            results: [
              {
                amount: { value: 1.5, currency: "usd" },
                project_id: "proj_birmel",
              },
            ],
          },
          {
            start_time: TODAY,
            results: [
              {
                amount: { value: 0.25, currency: "usd" },
                project_id: "proj_birmel",
              },
              {
                amount: { value: 3, currency: "usd" },
                project_id: "proj_scout",
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      }),
      "/v1/organization/usage/completions": () => ({
        data: [
          {
            start_time: TODAY,
            results: [
              {
                project_id: "proj_birmel",
                model: "gpt-5.6-sol",
                service_tier: "default",
                input_tokens: 100,
                output_tokens: 20,
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      }),
    });

    const result = await fetchOpenAiBilling({
      adminKey: "k",
      now: NOW,
      fetcher,
    });

    expect(result.costs).toEqual(
      expect.arrayContaining([
        {
          provider: "openai",
          account: "Birmel",
          todayUsd: 0.25,
          trailingSevenDaysUsd: 1.75,
        },
        {
          provider: "openai",
          account: "Scout for LoL",
          todayUsd: 3,
          trailingSevenDaysUsd: 3,
        },
      ]),
    );
    expect(result.tokens).toContainEqual({
      provider: "openai",
      account: "Birmel",
      model: "gpt-5.6-sol",
      serviceTier: "default",
      type: "input",
      tokens: 100,
    });
    // The week starts six days before today, so today makes seven buckets.
    const costsUrl = seen.find((url) => url.pathname.endsWith("/costs"));
    expect(costsUrl?.searchParams.get("start_time")).toBe(
      String(TODAY - 6 * 86_400),
    );
    expect(costsUrl?.searchParams.getAll("group_by")).toEqual(["project_id"]);
  });

  test("follows cost pagination to the end", async () => {
    let calls = 0;
    const { fetcher } = router({
      "/v1/organization/projects": () => ({ data: [], has_more: false }),
      "/v1/organization/costs": (url) => {
        calls += 1;
        return url.searchParams.get("page") === null
          ? {
              data: [
                {
                  start_time: TODAY,
                  results: [
                    { amount: { value: 1, currency: "usd" }, project_id: null },
                  ],
                },
              ],
              has_more: true,
              next_page: "page_2",
            }
          : {
              data: [
                {
                  start_time: TODAY,
                  results: [
                    { amount: { value: 2, currency: "usd" }, project_id: null },
                  ],
                },
              ],
              has_more: false,
              next_page: null,
            };
      },
      "/v1/organization/usage/completions": () => ({
        data: [],
        has_more: false,
        next_page: null,
      }),
    });

    const result = await fetchOpenAiBilling({
      adminKey: "k",
      now: NOW,
      fetcher,
    });
    expect(calls).toBe(2);
    expect(result.costs).toEqual([
      {
        provider: "openai",
        account: DEFAULT_ACCOUNT,
        todayUsd: 3,
        trailingSevenDaysUsd: 3,
      },
    ]);
  });

  test("labels a project the listing did not return by its id, not someone else's name", async () => {
    const { fetcher } = router({
      "/v1/organization/projects": () => ({ data: [], has_more: false }),
      "/v1/organization/costs": () => ({
        data: [
          {
            start_time: TODAY,
            results: [
              { amount: { value: 1, currency: "usd" }, project_id: "proj_new" },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      }),
      "/v1/organization/usage/completions": () => ({
        data: [],
        has_more: false,
        next_page: null,
      }),
    });
    const result = await fetchOpenAiBilling({
      adminKey: "k",
      now: NOW,
      fetcher,
    });
    expect(result.costs[0]?.account).toBe("proj_new");
  });

  test("a failed cost request fails the reconciliation", async () => {
    const { fetcher } = router({});
    await expect(
      fetchOpenAiBilling({ adminKey: "k", now: NOW, fetcher }),
    ).rejects.toThrow("OpenAI billing request failed: 404");
  });
});

describe("Anthropic billed cost", () => {
  test("converts cents and splits today from the trailing week", async () => {
    const { fetcher, seen } = router({
      "/v1/organizations/workspaces": () => ({
        data: [{ id: "wrkspc_prod", name: "prod" }],
        has_more: false,
      }),
      "/v1/organizations/cost_report": () => ({
        data: [
          {
            starting_at: new Date(YESTERDAY * 1000).toISOString(),
            results: [
              { amount: "250", currency: "USD", workspace_id: "wrkspc_prod" },
            ],
          },
          {
            starting_at: new Date(TODAY * 1000).toISOString(),
            results: [
              { amount: "125.5", currency: "USD", workspace_id: "wrkspc_prod" },
              // The default workspace reports a null id.
              { amount: "10", currency: "USD", workspace_id: null },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      }),
    });

    const costs = await fetchAnthropicBilling({
      adminKey: "k",
      now: NOW,
      fetcher,
    });

    expect(costs).toEqual(
      expect.arrayContaining([
        {
          provider: "anthropic",
          account: "prod",
          todayUsd: 1.255,
          trailingSevenDaysUsd: 3.755,
        },
        {
          provider: "anthropic",
          account: DEFAULT_ACCOUNT,
          todayUsd: 0.1,
          trailingSevenDaysUsd: 0.1,
        },
      ]),
    );
    const report = seen.find((url) => url.pathname.endsWith("/cost_report"));
    expect(report?.searchParams.getAll("group_by[]")).toEqual(["workspace_id"]);
    // Daily buckets only, so the window runs to the next UTC midnight.
    expect(report?.searchParams.get("ending_at")).toBe(
      new Date((TODAY + 86_400) * 1000).toISOString(),
    );
  });

  test("a non-numeric amount fails rather than counting as zero", async () => {
    const { fetcher } = router({
      "/v1/organizations/workspaces": () => ({ data: [], has_more: false }),
      "/v1/organizations/cost_report": () => ({
        data: [
          {
            starting_at: new Date(TODAY * 1000).toISOString(),
            results: [{ amount: "n/a", currency: "USD", workspace_id: null }],
          },
        ],
        has_more: false,
        next_page: null,
      }),
    });
    await expect(
      fetchAnthropicBilling({ adminKey: "k", now: NOW, fetcher }),
    ).rejects.toThrow("non-numeric amount");
  });
});
