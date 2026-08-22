import { expect, test } from "vitest";
import { Registry } from "prom-client";
import { commonLlmMetrics } from "#src/metrics.ts";

test("common LLM collectors are reused within a service registry", () => {
  const register = new Registry();
  expect(commonLlmMetrics(register)).toBe(commonLlmMetrics(register));
});
