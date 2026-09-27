import { afterEach, describe, expect, test, vi } from "vitest";
import {
  llmBilledCostUsd,
  llmBilledReconciliationLastSuccessTimestampSeconds,
  llmBilledTokens,
} from "#observability/metrics.ts";
import { llmBilledCostActivities } from "./llm-billed-cost.ts";

const billingMocks = vi.hoisted(() => ({
  fetchOpenAiBilling: vi.fn(),
  fetchAnthropicBilling: vi.fn(),
}));

vi.mock("@temporalio/activity", () => ({
  Context: { current: () => ({ cancellationSignal: undefined }) },
}));

vi.mock("#shared/llm-billing.ts", () => ({
  fetchOpenAiBilling: billingMocks.fetchOpenAiBilling,
  fetchAnthropicBilling: billingMocks.fetchAnthropicBilling,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("reconcileLlmBilledCost", () => {
  test("publishes each successful provider independently and retains failed feeds", async () => {
    vi.stubEnv("OPENAI_ADMIN_KEY", "test-openai-key");
    vi.stubEnv("ANTHROPIC_ADMIN_API_KEY", "test-anthropic-key");

    const anthropicCost = {
      provider: "anthropic" as const,
      account: "partial-anthropic-test",
      todayUsd: 2.5,
      trailingSevenDaysUsd: 10,
    };
    billingMocks.fetchOpenAiBilling.mockRejectedValueOnce(
      new Error("OpenAI billing unavailable"),
    );
    billingMocks.fetchAnthropicBilling.mockResolvedValueOnce([anthropicCost]);

    await expect(
      llmBilledCostActivities.reconcileLlmBilledCost(),
    ).rejects.toThrow("LLM billing reconciliation incomplete");

    const anthropicLastSuccess = await providerLastSuccess("anthropic");
    expect(anthropicLastSuccess).toBeGreaterThan(0);
    expect(await providerLastSuccess("openai")).toBeUndefined();
    expect(await costValue("anthropic", anthropicCost.account, "today")).toBe(
      anthropicCost.todayUsd,
    );

    const openAiCost = {
      provider: "openai" as const,
      account: "partial-openai-test",
      todayUsd: 3.75,
      trailingSevenDaysUsd: 15,
    };
    const openAiToken = {
      provider: "openai" as const,
      account: openAiCost.account,
      model: "gpt-5.6-luna",
      serviceTier: "default",
      type: "input" as const,
      tokens: 120,
    };
    billingMocks.fetchOpenAiBilling.mockResolvedValueOnce({
      costs: [openAiCost],
      tokens: [openAiToken],
    });
    billingMocks.fetchAnthropicBilling.mockRejectedValueOnce(
      new Error("Anthropic billing unavailable"),
    );

    await expect(
      llmBilledCostActivities.reconcileLlmBilledCost(),
    ).rejects.toThrow("LLM billing reconciliation incomplete");

    expect(await providerLastSuccess("openai")).toBeGreaterThan(0);
    expect(await providerLastSuccess("anthropic")).toBe(anthropicLastSuccess);
    expect(await costValue("openai", openAiCost.account, "today")).toBe(
      openAiCost.todayUsd,
    );
    expect(await costValue("anthropic", anthropicCost.account, "today")).toBe(
      anthropicCost.todayUsd,
    );
    expect(await tokenValue(openAiToken.account, openAiToken.model)).toBe(
      openAiToken.tokens,
    );
  });
});

async function providerLastSuccess(
  provider: "openai" | "anthropic",
): Promise<number | undefined> {
  const metric = await llmBilledReconciliationLastSuccessTimestampSeconds.get();
  return metric.values.find((value) => value.labels.provider === provider)
    ?.value;
}

async function costValue(
  provider: "openai" | "anthropic",
  account: string,
  window: "today" | "7d",
): Promise<number | undefined> {
  const metric = await llmBilledCostUsd.get();
  return metric.values.find(
    (value) =>
      value.labels.provider === provider &&
      value.labels.account === account &&
      value.labels.window === window,
  )?.value;
}

async function tokenValue(
  account: string,
  model: string,
): Promise<number | undefined> {
  const metric = await llmBilledTokens.get();
  return metric.values.find(
    (value) =>
      value.labels.provider === "openai" &&
      value.labels.account === account &&
      value.labels.model === model,
  )?.value;
}
