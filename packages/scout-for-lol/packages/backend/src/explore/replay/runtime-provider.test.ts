import { expect, test } from "vitest";
import { ReplayRuntimeProvider } from "./runtime-provider.ts";

test("pins runtime while allowing registry defaults for guild policies", async () => {
  const provider = new ReplayRuntimeProvider({
    analysisEnabled: true,
    model: "gpt-5.6-luna",
  });
  expect(
    await provider.resolveBooleanEvaluation(
      "scout-explore-analysis-enabled",
      false,
      {},
    ),
  ).toEqual({ value: true, reason: "STATIC" });
  expect(
    await provider.resolveStringEvaluation("scout-explore-model", "other", {}),
  ).toEqual({ value: "gpt-5.6-luna", reason: "STATIC" });
  expect(
    await provider.resolveBooleanEvaluation(
      "explore_creation_enabled",
      true,
      {},
    ),
  ).toMatchObject({ errorCode: "PROVIDER_NOT_READY" });
});
