import { afterEach, describe, expect, test } from "vitest";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { loadConfigFromEnvironment } from "@shepherdjerred/birmel/config/index.ts";
import {
  initializeDynamicConfig,
  shutdownDynamicConfig,
} from "@shepherdjerred/birmel/config/dynamic.ts";

const DISABLED = { FEATURE_FLAGS_MODE: "disabled" } as const;
const VALID_ENVIRONMENT = {
  DISCORD_TOKEN: "token",
  DISCORD_CLIENT_ID: "1".repeat(18),
  OPENROUTER_API_KEY: "key",
};

afterEach(async () => {
  await shutdownDynamicConfig();
});

describe("Birmel dynamic config", () => {
  test("applies typed flag values without changing bootstrap config", async () => {
    const config = loadConfigFromEnvironment(VALID_ENVIRONMENT);
    await initializeDynamicConfig({
      environment: DISABLED,
      config,
      startPolling: false,
      provider: new StaticProvider({
        "birmel-persona-enabled": false,
        "birmel-llm-model": "test-model",
        "birmel-agent-max-steps": 4,
      }),
    });

    expect(config.persona.enabled).toBe(false);
    expect(config.openRouter.model).toBe("test-model");
    expect(config.agent.maxSteps).toBe(4);
    expect(config.discord.token).toBe("token");
  });

  test("keeps current values when the provider is unavailable", async () => {
    const config = loadConfigFromEnvironment({
      ...VALID_ENVIRONMENT,
      PERSONA_ENABLED: "false",
    });
    await initializeDynamicConfig({
      environment: { ...DISABLED, PERSONA_ENABLED: "false" },
      config,
      startPolling: false,
    });

    expect(config.persona.enabled).toBe(false);
    expect(config.openRouter.model).toBe("gpt-5.6-luna");
  });

  test("keeps the seed when a flag has the wrong type", async () => {
    const config = loadConfigFromEnvironment(VALID_ENVIRONMENT);
    await initializeDynamicConfig({
      environment: DISABLED,
      config,
      startPolling: false,
      provider: new StaticProvider({ "birmel-agent-max-steps": "four" }),
    });

    expect(config.agent.maxSteps).toBe(8);
  });
});
