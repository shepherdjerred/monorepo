import { describe, expect, test } from "vitest";
import { loadConfigFromEnvironment } from "@shepherdjerred/birmel/config/index.ts";

const VALID_ENVIRONMENT = {
  DISCORD_TOKEN: "token",
  DISCORD_CLIENT_ID: "1".repeat(18),
  OPENAI_API_KEY: "key",
};

describe("strict environment configuration", () => {
  test("loads documented defaults", () => {
    const config = loadConfigFromEnvironment(VALID_ENVIRONMENT);
    expect(config.agent.maxSteps).toBe(12);
    expect(config.authority.trustedUserIds.length).toBeGreaterThan(0);
    expect(config.scheduler.maxConcurrentJobs).toBe(5);
    expect(config.sentry.tracesSampleRate).toBe(0);
  });

  test.each([
    ["malformed boolean", { TELEMETRY_ENABLED: "yes" }],
    ["malformed number", { AGENT_RESPONSE_TIMEOUT_MS: "fast" }],
    ["Bugsink performance tracing", { SENTRY_TRACES_SAMPLE_RATE: "0.5" }],
    ["non-positive timeout", { AGENT_RESPONSE_TIMEOUT_MS: "0" }],
    ["non-positive job concurrency", { SCHEDULER_MAX_CONCURRENT_JOBS: "0" }],
    [
      "non-positive scheduler operation timeout",
      { SCHEDULER_OPERATION_TIMEOUT_MS: "0" },
    ],
    ["too many steps", { AGENT_MAX_STEPS: "25" }],
    ["empty model", { LLM_MODEL: "" }],
    ["malformed user IDs", { TRUSTED_USER_IDS: '["not-a-user"]' }],
    ["short user IDs", { TRUSTED_USER_IDS: '["123"]' }],
    ["short client ID", { DISCORD_CLIENT_ID: "123" }],
    ["malformed timezone", { DAILY_POST_TIMEZONE: "Mars/Olympus" }],
  ])("rejects %s", (_label, overrides) => {
    expect(() =>
      loadConfigFromEnvironment({ ...VALID_ENVIRONMENT, ...overrides }),
    ).toThrow();
  });

  test("accepts explicit error-only Sentry configuration", () => {
    const config = loadConfigFromEnvironment({
      ...VALID_ENVIRONMENT,
      SENTRY_TRACES_SAMPLE_RATE: "0",
    });
    expect(config.sentry.tracesSampleRate).toBe(0);
  });

  test("rejects malformed JSON", () => {
    expect(() =>
      loadConfigFromEnvironment({
        ...VALID_ENVIRONMENT,
        TRUSTED_USER_IDS: "not-json",
      }),
    ).toThrow();
  });
});
