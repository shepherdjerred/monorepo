import { describe, expect, test } from "vitest";
import {
  DEFAULT_ACCOUNT,
  fetchAnthropicBilling,
  fetchOpenAiBilling,
  openAiBillingUrl,
  type BillingFetch,
} from "./llm-billing.ts";

// 2026-09-24T15:00:00Z; the UTC day starts at 2026-09-24T00:00:00Z.
const NOW = new Date("2026-09-24T15:00:00Z");
const TODAY = Math.floor(Date.UTC(2026, 8, 24) / 1000);
const YESTERDAY = TODAY - 86_400;

test("billing query metadata preserves reviewed query bytes without dispatch", () => {
  expect(
    openAiBillingUrl("usage/completions", {
      start_time: "100",
      end_time: "160",
      bucket_width: "1m",
      limit: "1",
      "models[]": ["reviewed-model"],
      "group_by[]": ["api_key_id", "project_id", "model", "service_tier"],
    }).toString(),
  ).toBe(
    "https://api.openai.com/v1/organization/usage/completions?start_time=100&end_time=160&bucket_width=1m&limit=1&models%5B%5D=reviewed-model&group_by%5B%5D=api_key_id&group_by%5B%5D=project_id&group_by%5B%5D=model&group_by%5B%5D=service_tier",
  );
  expect(
    openAiBillingUrl(
      "usage/decisions",
      {
        start_time: "100",
        end_time: "160",
        bucket_width: "1d",
        limit: "1",
        group_by: ["project_id", "model", "service_tier"],
      },
      "cursor_2",
    ).toString(),
  ).toBe(
    "https://api.openai.com/v1/organization/usage/decisions?start_time=100&end_time=160&bucket_width=1d&limit=1&group_by=project_id&group_by=model&group_by=service_tier&page=cursor_2",
  );
});

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

const emptyPage = () => ({
  data: [],
  has_more: false,
  next_page: null,
});

function fetchCostsOnly(costs: (url: URL) => unknown) {
  const { fetcher } = router({
    "/v1/organization/projects": () => ({ data: [], has_more: false }),
    "/v1/organization/costs": costs,
    "/v1/organization/usage/completions": emptyPage,
    "/v1/organization/usage/decisions": emptyPage,
  });
  return fetchOpenAiBilling({
    adminKey: "k",
    now: NOW,
    fetcher,
  });
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
      "/v1/organization/usage/decisions": emptyPage,
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
    const result = await fetchCostsOnly((url) => {
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
    const result = await fetchCostsOnly(() => ({
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
    }));
    expect(result.costs[0]?.account).toBe("proj_new");
  });

  test("a failed cost request fails the reconciliation", async () => {
    const { fetcher } = router({});
    await expect(
      fetchOpenAiBilling({ adminKey: "k", now: NOW, fetcher }),
    ).rejects.toThrow("OpenAI billing request failed: 404");
  });
});

describe("OpenAI decisions usage reconciliation", () => {
  test("paginates usage/decisions and aggregates token series shared with usage/completions", async () => {
    let decisionCalls = 0;
    const { fetcher, seen } = router({
      "/v1/organization/projects": () => ({
        data: [
          { id: "proj_birmel", name: "Birmel" },
          { id: "proj_scout", name: "Scout for LoL" },
        ],
        has_more: false,
      }),
      "/v1/organization/costs": () => ({
        data: [],
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
                model: "gpt-6-luna",
                service_tier: "default",
                input_tokens: 400,
                output_tokens: 60,
              },
            ],
          },
        ],
        has_more: false,
        next_page: null,
      }),
      "/v1/organization/usage/decisions": (url) => {
        decisionCalls += 1;
        return url.searchParams.get("page") === null
          ? {
              data: [
                {
                  start_time: TODAY,
                  results: [
                    {
                      project_id: "proj_birmel",
                      model: "gpt-6-luna",
                      service_tier: "default",
                      input_tokens: 900,
                      output_tokens: 30,
                    },
                  ],
                },
              ],
              has_more: true,
              next_page: "decisions_page_2",
            }
          : {
              data: [
                {
                  start_time: TODAY,
                  results: [
                    {
                      project_id: "proj_birmel",
                      model: "gpt-6-luna",
                      service_tier: null,
                      input_tokens: 100,
                    },
                    {
                      project_id: "proj_scout",
                      model: "gpt-6-luna",
                      service_tier: "default",
                      input_tokens: 250,
                      output_tokens: 0,
                    },
                  ],
                },
              ],
              has_more: false,
              next_page: null,
            };
      },
    });

    const result = await fetchOpenAiBilling({
      adminKey: "k",
      now: NOW,
      fetcher,
    });

    expect(decisionCalls).toBe(2);
    const decisionsUrl = seen.find((url) =>
      url.pathname.endsWith("/usage/decisions"),
    );
    expect(decisionsUrl?.searchParams.get("start_time")).toBe(String(TODAY));
    expect(decisionsUrl?.searchParams.get("bucket_width")).toBe("1d");
    expect(decisionsUrl?.searchParams.getAll("group_by")).toEqual([
      "project_id",
      "model",
      "service_tier",
    ]);

    expect(result.tokens).toHaveLength(4);
    expect(result.tokens).toEqual(
      expect.arrayContaining([
        {
          provider: "openai",
          account: "Birmel",
          model: "gpt-6-luna",
          serviceTier: "default",
          type: "input",
          tokens: 1400,
        },
        {
          provider: "openai",
          account: "Birmel",
          model: "gpt-6-luna",
          serviceTier: "default",
          type: "output",
          tokens: 90,
        },
        {
          provider: "openai",
          account: "Scout for LoL",
          model: "gpt-6-luna",
          serviceTier: "default",
          type: "input",
          tokens: 250,
        },
        {
          provider: "openai",
          account: "Scout for LoL",
          model: "gpt-6-luna",
          serviceTier: "default",
          type: "output",
          tokens: 0,
        },
      ]),
    );
  });

  test("a failed usage/decisions request fails the reconciliation", async () => {
    const { fetcher } = router({
      "/v1/organization/projects": () => ({ data: [], has_more: false }),
      "/v1/organization/costs": () => ({
        data: [],
        has_more: false,
        next_page: null,
      }),
      "/v1/organization/usage/completions": () => ({
        data: [],
        has_more: false,
        next_page: null,
      }),
    });
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
