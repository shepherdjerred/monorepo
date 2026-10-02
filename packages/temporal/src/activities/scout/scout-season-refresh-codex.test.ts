import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn(), secrets: vi.fn() }));
vi.mock("#lib/agent-runner/codex.ts", () => ({ runCodexAgentTurn: mocks.run }));
vi.mock("#activities/agent/agent-task-env.ts", () => ({
  createAgentTaskSecretTokenState: mocks.secrets,
  envForTrustedAgent: (env: Record<string, string>) => env,
}));
vi.mock("#activities/agent/agent-task-runtime.ts", () => ({
  activityCancellationSignalOrUndefined: vi.fn(),
  startToCloseTimeoutMsOrUndefined: vi.fn(),
}));
vi.mock("#lib/agent-runner/callbacks.ts", () => ({
  createAgentSecretRefreshHandler: () => vi.fn(),
  createTemporalAgentEventHandler: () => vi.fn(),
}));

import { runSeasonAgent } from "./scout-season-refresh-codex.ts";

const input = {
  workdir: "/tmp/season-test/monorepo",
  model: "gpt-6-luna",
  maxTurns: 10,
  seasonsFile: "seasons.ts",
  seasonsTestFile: "seasons.test.ts",
  changelogFile: "changelog.tsx",
  noDriftSentinel: "NO_DRIFT",
  driftedSentinel: "DRIFTED",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

test("the migrated season worker authenticates directly with OpenAI without the retired provider", async () => {
  vi.stubEnv("OPENAI_API_KEY", "fixture-openai-key");
  vi.stubEnv("OPENROUTER_API_KEY", undefined);
  mocks.secrets.mockResolvedValue({ tokens: [], refresh: vi.fn() });
  mocks.run.mockResolvedValue({
    durationMs: 1,
    numTurns: 1,
    finalText: "NO_DRIFT",
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
    },
  });
  expect(await runSeasonAgent(input)).toMatchObject({
    exitCode: 0,
    resultText: "NO_DRIFT",
  });
  expect(mocks.run).toHaveBeenCalledWith(
    expect.objectContaining({
      auth: { kind: "openai-api-key", apiKey: "fixture-openai-key" },
      env: { OPENAI_API_KEY: "fixture-openai-key" },
      callSite: "scout-season-refresh",
      maxTurns: 10,
      turnBudgetKind: "turns",
      signal: expect.any(AbortSignal),
    }),
  );
});

test("a retired provider credential cannot substitute for missing OpenAI authentication", async () => {
  vi.stubEnv("OPENAI_API_KEY", undefined);
  vi.stubEnv("OPENROUTER_API_KEY", "fixture-retired-key");
  await expect(runSeasonAgent(input)).rejects.toThrow(
    "OPENAI_API_KEY is required",
  );
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.secrets).not.toHaveBeenCalled();
});
