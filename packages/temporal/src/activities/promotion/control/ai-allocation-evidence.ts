import { createHash } from "node:crypto";
import { costForTextUsage, getModel } from "@shepherdjerred/llm-models";
import type { PromotionAiAllocationRequest } from "@shepherdjerred/ops-model/promotion/ai-allocation.ts";
import { openAiBillingUrl } from "#shared/llm-billing.ts";

function providerWindow(input: PromotionAiAllocationRequest) {
  const provider = input.provider;
  const start = Date.parse(provider.startAt) / 1000;
  const end = Date.parse(provider.endAt) / 1000;
  const minutes = (end - start) / 60;
  if (
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 60 ||
    start % 60 !== 0
  )
    throw new Error(
      "Provider window must contain 1–60 complete minute buckets",
    );
  if (
    Date.parse(provider.startAt) > Date.parse(input.executionStartedAt) ||
    Date.parse(provider.endAt) < Date.parse(input.executionClosedAt) ||
    Date.parse(provider.observedAt) < Date.parse(provider.endAt)
  )
    throw new Error(
      "Reviewed provider window must cover the whole closed execution",
    );
  const url = openAiBillingUrl("usage/completions", {
    start_time: String(start),
    end_time: String(end),
    bucket_width: "1m",
    limit: String(minutes),
    "models[]": [provider.model],
    "group_by[]": ["api_key_id", "project_id", "model", "service_tier"],
  });
  if (
    createHash("sha256").update(url.toString()).digest("hex") !==
    provider.querySha256
  )
    throw new Error(
      "Provider query digest does not match the reviewed window and model",
    );
  if (provider.buckets.length !== minutes)
    throw new Error(
      "Provider response does not contain the complete reviewed window",
    );
  return { start, query: url.toString() };
}

/** Price the complete reviewed response, retaining its uncertainty and overcounting other runs. */
export function pricePromotionAiEvidence(input: PromotionAiAllocationRequest) {
  const provider = input.provider;
  const window = providerWindow(input);
  const total = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    numModelRequests: 0,
  };
  for (const [index, bucket] of provider.buckets.entries()) {
    if (
      bucket.startTime !== window.start + index * 60 ||
      bucket.endTime !== window.start + (index + 1) * 60
    )
      throw new Error(
        "Provider response buckets are missing, duplicated or unordered",
      );
    for (const row of bucket.results) {
      if (
        row.apiKeyId !== provider.apiKeyId ||
        row.projectId !== provider.projectId ||
        row.model !== provider.model
      )
        throw new Error(
          "Provider row identity differs from the reviewed identity",
        );
      total.inputTokens += row.inputTokens;
      total.cachedInputTokens += row.cachedInputTokens;
      total.outputTokens += row.outputTokens;
      total.numModelRequests += row.numModelRequests;
    }
  }
  if (!Object.values(total).every((value) => Number.isSafeInteger(value)))
    throw new Error("Provider usage totals exceed safe integer accounting");
  if (total.numModelRequests === 0)
    throw new Error("An empty provider snapshot cannot establish zero usage");
  // A combined window can only add this catalog's long-context surcharge.
  const amountUsd = costForTextUsage(provider.model, total);
  if (amountUsd === undefined || !Number.isFinite(amountUsd) || amountUsd <= 0)
    throw new Error(
      "Positive provider usage cannot be conservatively priced by this catalog",
    );
  return {
    amountUsd,
    total,
    query: window.query,
    model: getModel(provider.model),
  };
}
