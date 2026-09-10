import { afterEach, expect, test } from "vitest";
import { resolveFleetModel } from "@shepherdjerred/pr-fleet-controller/src/domain/model-resolution.ts";

const originalOpenRouterApiKey = Bun.env["OPENROUTER_API_KEY"];

afterEach(() => {
  if (originalOpenRouterApiKey === undefined) {
    delete Bun.env["OPENROUTER_API_KEY"];
  } else {
    Bun.env["OPENROUTER_API_KEY"] = originalOpenRouterApiKey;
  }
});

test("fails before reconciliation when OpenRouter has no API key", () => {
  delete Bun.env["OPENROUTER_API_KEY"];
  expect(() => resolveFleetModel("gpt-5.6-terra")).toThrow(
    "OPENROUTER_API_KEY is required",
  );
});

test("resolves a stable catalog model through OpenRouter", () => {
  const resolved = resolveFleetModel("gpt-5.6-terra", "test-openrouter-key");
  expect(resolved.id).toBe("gpt-5.6-terra");
  expect(resolved.runtime.service).toBe("pr-fleet-controller");
});

test("fails visibly when the catalog route is missing", () => {
  expect(() =>
    resolveFleetModel("not-a-catalog-model", "test-openrouter-key"),
  ).toThrow("Unknown model id");
});
