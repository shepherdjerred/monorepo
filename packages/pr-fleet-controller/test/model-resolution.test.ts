import { afterEach, expect, test } from "bun:test";
import { resolveFleetModel } from "@shepherdjerred/pr-fleet-controller/src/model-resolution.ts";

const originalOpenAiApiKey = Bun.env["OPENAI_API_KEY"];

afterEach(() => {
  if (originalOpenAiApiKey === undefined) {
    delete Bun.env["OPENAI_API_KEY"];
  } else {
    Bun.env["OPENAI_API_KEY"] = originalOpenAiApiKey;
  }
});

test("fails before reconciliation when an OpenAI model has no API key", () => {
  delete Bun.env["OPENAI_API_KEY"];
  expect(() =>
    resolveFleetModel("openai/gpt-5.6-terra", undefined, undefined),
  ).toThrow("OPENAI_API_KEY is required");
});

test("accepts an OpenAI model when its API key is injected", () => {
  Bun.env["OPENAI_API_KEY"] = "test-key";
  expect(resolveFleetModel("openai/gpt-5.6-terra", undefined, undefined)).toBe(
    "openai/gpt-5.6-terra",
  );
});
