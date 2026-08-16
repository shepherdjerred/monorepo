import { expect, test } from "bun:test";
import { getLlmRuleGroups } from "./llm.ts";

test("keeps LLM recording and Broadcast alert coverage together", () => {
  const rules = JSON.stringify(getLlmRuleGroups());
  expect(rules).toContain("llm:requests:rate5m");
  expect(rules).toContain("llm:request_duration:p95_5m");
  expect(rules).toContain("LlmOpenRouterMetadataMissing");
  expect(rules).toContain("LlmStructuredOutputExhausted");
  expect(rules).toContain("OpenRouterBroadcastPipelineFailure");
  expect(rules).toContain("OpenRouterBroadcastTargetDown");
});
