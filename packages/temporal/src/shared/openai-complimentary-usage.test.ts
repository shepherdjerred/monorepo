import { describe, expect, test } from "vitest";
import { buildOpenAiComplimentaryAlerts } from "./alerts/openai-complimentary-alerts.ts";
import {
  fetchOpenAiComplimentaryUsage,
  type OpenAiUsageFetch,
} from "./openai-complimentary-usage.ts";

function page(results: readonly unknown[], input?: { next?: string }) {
  return {
    object: "page",
    data: [{ start_time: 1, end_time: 2, results }],
    has_more: input?.next !== undefined,
    next_page: input?.next ?? null,
  };
}

function requestUrl(request: Parameters<OpenAiUsageFetch>[0]): URL {
  if (typeof request === "string") return new URL(request);
  if (request instanceof URL) return request;
  return new URL(request.url);
}

const malformedPaginationFetcher: OpenAiUsageFetch = () =>
  Promise.resolve(
    Response.json({ ...page([]), has_more: true, next_page: null }),
  );

describe("OpenAI complimentary usage", () => {
  test("paginates, applies the ingestion cutoff, and aggregates tiers and cost", async () => {
    const urls: URL[] = [];
    const signals: (AbortSignal | null | undefined)[] = [];
    const cancellationController = new AbortController();
    const fetcher: OpenAiUsageFetch = (request, init) => {
      const url = requestUrl(request);
      urls.push(url);
      signals.push(init?.signal);
      if (url.pathname.endsWith("/usage/completions")) {
        const second = url.searchParams.get("page") === "completion-next";
        return Promise.resolve(
          Response.json(
            page(
              [
                {
                  input_tokens: second ? 7 : 100,
                  output_tokens: second ? 3 : 20,
                  model: "gpt-5.4-mini",
                  service_tier: second ? "default" : "incentivized-tier",
                },
              ],
              second ? undefined : { next: "completion-next" },
            ),
          ),
        );
      }
      return Promise.resolve(
        Response.json(
          page([
            {
              amount: { value: 0.0125, currency: "usd" },
              project_id: "project-openrouter",
            },
          ]),
        ),
      );
    };

    const result = await fetchOpenAiComplimentaryUsage({
      adminKey: "test-admin-key",
      projectId: "project-openrouter",
      now: new Date("2026-09-01T08:17:00.000Z"),
      fetcher,
      cancellationSignal: cancellationController.signal,
    });

    expect(result.windowStart).toBe("2026-09-01T00:00:00.000Z");
    expect(result.windowEnd).toBe("2026-09-01T08:02:00.000Z");
    expect(result.defaultTierTokens).toBe(10);
    expect(result.costUsd).toBe(0.0125);
    expect(result.tokenRows).toEqual(
      expect.arrayContaining([
        {
          model: "gpt-5.4-mini",
          serviceTier: "incentivized-tier",
          type: "input",
          tokens: 100,
        },
        {
          model: "gpt-5.4-mini",
          serviceTier: "default",
          type: "output",
          tokens: 3,
        },
      ]),
    );
    expect(urls).toHaveLength(3);
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
    for (const url of urls) {
      expect(url.searchParams.get("end_time")).toBe("1788249720");
      expect(url.searchParams.get("project_ids")).toBe("project-openrouter");
    }
  });

  test("fails closed on malformed pagination", async () => {
    await expect(
      fetchOpenAiComplimentaryUsage({
        adminKey: "test-admin-key",
        projectId: "project-openrouter",
        now: new Date("2026-09-01T08:17:00.000Z"),
        fetcher: malformedPaginationFetcher,
      }),
    ).rejects.toThrow("has_more without a next_page");
  });

  test("fires and resolves stable paid-tier and cost alerts", () => {
    const now = new Date("2026-09-01T08:17:00.000Z");
    const base = {
      windowStart: "2026-09-01T00:00:00.000Z",
      windowEnd: "2026-09-01T08:02:00.000Z",
      observedAt: now.toISOString(),
      tokenRows: [],
    };
    const firing = buildOpenAiComplimentaryAlerts(
      { ...base, defaultTierTokens: 1, costUsd: 0.01 },
      now,
    );
    const resolved = buildOpenAiComplimentaryAlerts(
      { ...base, defaultTierTokens: 0, costUsd: 0 },
      now,
    );
    expect(firing.map((entry) => entry.labels["alertname"])).toEqual([
      "OpenAiComplimentaryPaidTokens",
      "OpenAiOpenRouterProjectCost",
    ]);
    expect(firing.every((entry) => entry.endsAt > entry.startsAt)).toBe(true);
    expect(resolved.every((entry) => entry.endsAt === entry.startsAt)).toBe(
      true,
    );
  });
});
