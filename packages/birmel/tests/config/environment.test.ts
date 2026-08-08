import { describe, expect, test } from "bun:test";
import { loadConfigFromEnvironment } from "@shepherdjerred/birmel/config/index.ts";

const VALID_ENVIRONMENT = {
  DISCORD_TOKEN: "token",
  DISCORD_CLIENT_ID: "1".repeat(18),
  OPENAI_API_KEY: "key",
};

describe("strict environment configuration", () => {
  test("loads documented defaults", () => {
    const config = loadConfigFromEnvironment(VALID_ENVIRONMENT);
    expect(config.agent.maxSteps).toBe(8);
    expect(config.authority.trustedUserIds.length).toBeGreaterThan(0);
  });

  test.each([
    ["malformed boolean", { TELEMETRY_ENABLED: "yes" }],
    ["malformed number", { AGENT_RESPONSE_TIMEOUT_MS: "fast" }],
    ["non-positive timeout", { AGENT_RESPONSE_TIMEOUT_MS: "0" }],
    ["too many steps", { AGENT_MAX_STEPS: "9" }],
    ["empty model", { OPENAI_MODEL: "" }],
    ["malformed user IDs", { TRUSTED_USER_IDS: '["not-a-user"]' }],
    ["short user IDs", { TRUSTED_USER_IDS: '["123"]' }],
    ["short client ID", { DISCORD_CLIENT_ID: "123" }],
    ["malformed timezone", { DAILY_POST_TIMEZONE: "Mars/Olympus" }],
  ])("rejects %s", (_label, overrides) => {
    expect(() =>
      loadConfigFromEnvironment({ ...VALID_ENVIRONMENT, ...overrides }),
    ).toThrow();
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
