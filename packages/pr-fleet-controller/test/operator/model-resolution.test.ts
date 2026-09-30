import { expect, test } from "vitest";
import { resolveFleetModel } from "@shepherdjerred/pr-fleet-controller/src/domain/model-resolution.ts";

test("fails before reconciliation when the model's provider is unconfigured", () => {
  // There is no single key to check up front any more: which credential a run
  // needs depends on the model it resolves, so the failure names the provider.
  expect(() => resolveFleetModel("gpt-5.6-terra", {})).toThrow(
    "no OpenAI credentials were configured",
  );
  expect(() =>
    resolveFleetModel("claude-sonnet-5", { openai: { apiKey: "test-key" } }),
  ).toThrow("no Anthropic credentials were configured");
});

test("resolves a stable catalog model to its first-party provider", () => {
  const resolved = resolveFleetModel("gpt-5.6-terra", {
    openai: { apiKey: "test-key" },
  });
  expect(resolved.id).toBe("gpt-5.6-terra");
  expect(resolved.runtime.service).toBe("pr-fleet-controller");
});

test("fails visibly when the catalog route is missing", () => {
  expect(() =>
    resolveFleetModel("not-a-catalog-model", {
      openai: { apiKey: "test-key" },
    }),
  ).toThrow("Unknown model id");
});
