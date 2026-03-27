import { describe, it, expect, beforeEach } from "bun:test";
import "./helpers.ts";
import {
  getConfig,
  resetConfig,
} from "@shepherdjerred/sentinel/config/index.ts";

describe("config", () => {
  beforeEach(() => {
    // Clear env vars that other test files may set so defaults are used
    delete Bun.env["QUEUE_POLL_INTERVAL_MS"];
    delete Bun.env["APPROVAL_TIMEOUT_MS"];
    resetConfig();
  });

  it("getConfig returns full valid config when all env vars are set", () => {
    // Override TELEMETRY_ENABLED so test is independent of .env file
    Bun.env["TELEMETRY_ENABLED"] = "true";
    resetConfig();

    const config = getConfig();

    expect(config.anthropic.apiKey).toBe("test-key");
    expect(config.anthropic.model).toBe("claude-sonnet-4-20250514");
    expect(config.discord).toBeDefined();
    expect(config.discord?.token).toBe("test-token");
    expect(config.discord?.channelId).toBe("test-channel");
    expect(config.discord?.guildId).toBe("test-guild");
    expect(config.discord?.approverRoleIds).toEqual([]);
    expect(config.sentry.enabled).toBe(false);
    expect(config.sentry.environment).toBe("development");
    expect(config.telemetry.enabled).toBe(true);
    expect(config.queue.pollIntervalMs).toBe(5000);
    expect(config.queue.maxJobDurationMs).toBe(600_000);
    expect(config.queue.defaultMaxRetries).toBe(3);
    expect(config.webhooks.port).toBe(3000);
    expect(config.webhooks.host).toBe("0.0.0.0");
    expect(config.permissions.approvalTimeoutMs).toBe(1_800_000);

    delete Bun.env["TELEMETRY_ENABLED"];
  });

  it("getConfig with missing optional vars uses defaults", () => {
    const savedToken = Bun.env["DISCORD_TOKEN"];
    Bun.env["DISCORD_TOKEN"] = "";

    try {
      const config = getConfig();
      expect(config.discord).toBeUndefined();
    } finally {
      Bun.env["DISCORD_TOKEN"] = savedToken;
    }
  });

  it("getConfig returns cached instance on subsequent calls", () => {
    const first = getConfig();
    const second = getConfig();
    expect(second).toBe(first);
  });

  it("resetConfig clears cache so next getConfig returns new instance", () => {
    const first = getConfig();
    resetConfig();
    const second = getConfig();
    expect(second).not.toBe(first);
  });

  it("throws when required ANTHROPIC_API_KEY is missing", () => {
    const savedKey = Bun.env["ANTHROPIC_API_KEY"];
    Bun.env["ANTHROPIC_API_KEY"] = "";

    try {
      expect(() => getConfig()).toThrow();
    } finally {
      Bun.env["ANTHROPIC_API_KEY"] = savedKey;
    }
  });

  it("treats op:// references as unset", () => {
    const savedKey = Bun.env["ANTHROPIC_API_KEY"];
    Bun.env["ANTHROPIC_API_KEY"] = "op://vault/item/field";

    try {
      expect(() => getConfig()).toThrow();
    } finally {
      Bun.env["ANTHROPIC_API_KEY"] = savedKey;
    }
  });

  it("ignores op:// discord token and returns undefined discord config", () => {
    const savedToken = Bun.env["DISCORD_TOKEN"];
    Bun.env["DISCORD_TOKEN"] = "op://vault/item/token";

    try {
      const config = getConfig();
      expect(config.discord).toBeUndefined();
    } finally {
      Bun.env["DISCORD_TOKEN"] = savedToken;
    }
  });
});
