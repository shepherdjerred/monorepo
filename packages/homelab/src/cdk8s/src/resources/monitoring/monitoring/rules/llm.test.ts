import { expect, test } from "vitest";
import { getLlmRuleGroups } from "./llm.ts";

test("keeps LLM recording and Broadcast alert coverage together", () => {
  const groups = getLlmRuleGroups();
  const serialized = JSON.stringify(groups);
  expect(serialized).toContain("llm:requests:rate5m");
  expect(serialized).toContain("llm:request_duration:p95_5m");
  expect(serialized).toContain("LlmOpenRouterMetadataMissing");
  expect(serialized).toContain("LlmStructuredOutputExhausted");
  expect(serialized).toContain("birmel_admission_classifier_total");
  expect(serialized).toContain("birmel_memory_extraction_total");
  expect(serialized).toContain("OpenRouterBroadcastPipelineFailure");
  expect(serialized).toContain("OpenRouterBroadcastTargetDown");

  const rules = groups.flatMap(({ rules: groupRules }) => groupRules);

  const targetDown = rules.find(
    (rule) => rule?.alert === "OpenRouterBroadcastTargetDown",
  );
  expect(targetDown?.expr?.value).toContain(
    'service="openrouter-broadca-openrouter-broadcast-ingest-service"',
  );
  expect(targetDown?.expr?.value).not.toContain(
    'service="openrouter-broadcast-ingest-service"',
  );

  for (const alertName of [
    "BirmelAdmissionClassifierErrors",
    "BirmelMemoryExtractionErrors",
  ]) {
    const alert = rules.find((rule) => rule?.alert === alertName);
    expect(alert?.labels).toEqual({ severity: "warning", category: "llm" });
  }
});
