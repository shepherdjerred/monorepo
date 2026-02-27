import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "./config.ts";

describe("loadConfig", () => {
  const originalEnv = { ...Bun.env };

  beforeEach(() => {
    Bun.env["OBSIDIAN_TOKEN"] = "test-token-123";
    Bun.env["OBSIDIAN_VAULT_PASSWORD"] = "vaultpass";
    Bun.env["OBSIDIAN_VAULT_NAME"] = "My Vault";
    Bun.env["VAULT_PATH"] = "/tmp/vault";
  });

  afterEach(() => {
    // Remove test-added keys that aren't in the original snapshot
    for (const key of Object.keys(Bun.env)) {
      if (!(key in originalEnv)) {
        Bun.env[key] = undefined;
      }
    }
    // Restore original values
    Object.assign(Bun.env, originalEnv);
  });

  test("loads valid config from env", () => {
    const config = loadConfig();
    expect(config.token).toBe("test-token-123");
    expect(config.vaultPassword).toBe("vaultpass");
    expect(config.vaultName).toBe("My Vault");
    expect(config.vaultPath).toBe("/tmp/vault");
    expect(config.logLevel).toBe("info");
  });

  test("uses custom log level", () => {
    Bun.env["LOG_LEVEL"] = "debug";
    const config = loadConfig();
    expect(config.logLevel).toBe("debug");
  });

  test("throws on missing token", () => {
    Bun.env["OBSIDIAN_TOKEN"] = undefined;
    expect(() => loadConfig()).toThrow();
  });

  test("throws on empty token", () => {
    Bun.env["OBSIDIAN_TOKEN"] = "";
    expect(() => loadConfig()).toThrow();
  });
});
