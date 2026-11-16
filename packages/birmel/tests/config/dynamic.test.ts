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
  OPENAI_API_KEY: "key",
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
        "birmel-llm-decisions-enabled": false,
        "birmel-llm-decisions-model": "gpt-6-luna",
        "birmel-llm-decisions-threshold": 0,
        "birmel-agent-max-steps": 4,
        "birmel-llm-image-model": "test-image-model",
      }),
    });

    expect(config.persona.enabled).toBe(false);
    expect(config.llm.model).toBe("test-model");
    expect(config.llm.decisionsEnabled).toBe(false);
    expect(config.llm.decisionsModel).toBe("gpt-6-luna");
    expect(config.llm.decisionsThreshold).toBe(0);
    expect(config.agent.maxSteps).toBe(4);
    expect(config.llm.imageModel).toBe("test-image-model");
    expect(config.discord.token).toBe("token");
  });

  test("resolves Decisions API defaults on flag absence without reading env vars", async () => {
    const config = loadConfigFromEnvironment(VALID_ENVIRONMENT);
    await initializeDynamicConfig({
      environment: {
        ...DISABLED,
        LLM_DECISIONS_ENABLED: "false",
        LLM_DECISIONS_MODEL: "wrong-model",
        LLM_DECISIONS_THRESHOLD: "0.95",
      },
      config,
      startPolling: false,
      provider: new StaticProvider({}),
    });

    expect(config.llm.decisionsEnabled).toBe(true);
    expect(config.llm.decisionsModel).toBe("gpt-6-luna");
    expect(config.llm.decisionsThreshold).toBe(0.5);
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
    expect(config.llm.model).toBe("gpt-6.1-sol");
    expect(config.llm.decisionsEnabled).toBe(true);
    expect(config.llm.decisionsModel).toBe("gpt-6-luna");
    expect(config.llm.decisionsThreshold).toBe(0.5);
  });

  test("keeps the seed when a flag has the wrong type or out-of-range value", async () => {
    const logs: string[] = [];
    const config = loadConfigFromEnvironment(VALID_ENVIRONMENT);
    await initializeDynamicConfig({
      environment: DISABLED,
      config,
      startPolling: false,
      log: (message) => {
        logs.push(message);
      },
      provider: new StaticProvider({
        "birmel-agent-max-steps": "four",
        "birmel-llm-decisions-threshold": 1.5,
        "birmel-llm-decisions-model": "   ",
      }),
    });

    expect(config.agent.maxSteps).toBe(12);
    expect(config.llm.decisionsThreshold).toBe(0.5);
    expect(config.llm.decisionsModel).toBe("gpt-6-luna");
    expect(logs.some((entry) => entry.includes("decisionsThreshold"))).toBe(
      true,
    );
    expect(logs.some((entry) => entry.includes("decisionsModel"))).toBe(true);
  });
});
