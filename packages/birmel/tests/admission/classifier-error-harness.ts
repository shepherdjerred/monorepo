// Runs in a dedicated Vitest process because module mocks are process-global.
import { expect, test, vi } from "vitest";

let decisionsEnabled = true;

vi.doMock("@shepherdjerred/llm-runtime", () => ({
  generateValidatedObject: () =>
    Promise.reject(new Error("structured classifier failure")),
}));

vi.doMock("@shepherdjerred/birmel/agent-runtime/llm.ts", () => ({
  getLlmRuntime: () => ({
    decide: () => Promise.reject(new Error("decisions classifier failure")),
  }),
}));

vi.doMock("@shepherdjerred/birmel/config/index.ts", () => ({
  getConfig: () => ({
    llm: {
      classifierModel: "gpt-6-luna",
      decisionsEnabled,
      decisionsModel: "gpt-6-luna",
      decisionsThreshold: 0.5,
      reasoningEffort: "low",
    },
    agent: { auxiliaryTimeoutMs: 1000 },
    persona: { enabled: true },
  }),
}));

vi.doMock("@shepherdjerred/birmel/persona/projection.ts", () => ({
  buildConfiguredPersonaProjection: () => "persona",
}));

const [{ classifyShouldRespond }, { metricsRegister }] = await Promise.all([
  import("@shepherdjerred/birmel/discord/should-respond-classifier.ts"),
  import("@shepherdjerred/birmel/observability/metrics.ts"),
]);

test("fails closed and records admission classifier errors across Decisions and fallback paths", async () => {
  decisionsEnabled = true;
  await expect(
    classifyShouldRespond({
      persona: "virmel",
      transcript: "",
      latestMessage: "ambiguous chatter",
      guildId: "100000000000000001",
      channelId: "100000000000000002",
      userId: "100000000000000003",
    }),
  ).resolves.toBe(false);

  decisionsEnabled = false;
  await expect(
    classifyShouldRespond({
      persona: "virmel",
      transcript: "",
      latestMessage: "ambiguous chatter",
      guildId: "100000000000000001",
      channelId: "100000000000000002",
      userId: "100000000000000003",
    }),
  ).resolves.toBe(false);

  const metric = await metricsRegister
    .getSingleMetric("birmel_admission_classifier_total")
    ?.get();
  expect(
    metric?.values.some(
      ({ labels, value }) => labels["outcome"] === "error" && value === 2,
    ),
  ).toBe(true);
});
