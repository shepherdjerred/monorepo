import { expect, it } from "vitest";
import type { ConfigSource } from "@shepherdjerred/config/source.ts";
import { loadBootstrap, loadPilotConfig } from "./config.ts";

const PILOT_FILE = new URL("../pilot.json", import.meta.url).pathname;

function flagSource(value: unknown): ConfigSource {
  return {
    name: "flag",
    get: (names) => {
      expect(names.flag).toBe("the-storm-companion-pilot-enabled");
      return Promise.resolve({ value });
    },
  };
}

it("ships disabled with one pilot account and a two-hour Pacific window", async () => {
  const config = await loadPilotConfig(PILOT_FILE);
  expect(config.enabled).toBe(false);
  expect(config.maxCompanions).toBe(1);
  expect([config.startHour, config.endHour]).toEqual([18, 20]);
  expect(config.llmEnabled).toBe(false);
  expect(config.llmModel).toBe("gpt-6-luna");
  expect(config.monthlyBudgetUsd).toBe(20);
});

it("accepts a targeted flag while preserving the disabled file default", async () => {
  const config = await loadPilotConfig(PILOT_FILE, flagSource(true));
  expect(config.enabled).toBe(true);
});

it("lets an explicit false flag disable a file-enabled pilot", async () => {
  const original = await Bun.file(PILOT_FILE).text();
  const path = `${Bun.env["TMPDIR"] ?? "/tmp"}/storm-pilot-enabled-${crypto.randomUUID()}.json`;
  try {
    await Bun.write(
      path,
      original.replace('"enabled": false', '"enabled": true'),
    );
    const config = await loadPilotConfig(path, flagSource(false));
    expect(config.enabled).toBe(false);
    const absent: ConfigSource = {
      name: "flag",
      get: () => Promise.resolve(undefined),
    };
    const withoutFlag = await loadPilotConfig(path, absent);
    expect(withoutFlag.enabled).toBe(true);
  } finally {
    await Bun.file(path).delete();
  }
});

it("rejects an invalid flag value and falls back when its source fails", async () => {
  await expect(loadPilotConfig(PILOT_FILE, flagSource("on"))).rejects.toThrow();
  const failing: ConfigSource = {
    name: "flag",
    get: () => Promise.reject(new Error("provider unavailable")),
  };
  const fallback = await loadPilotConfig(PILOT_FILE, failing);
  expect(fallback.enabled).toBe(false);
});

it("reads only required bootstrap values from a real process environment", () => {
  expect(
    loadBootstrap({
      PATH: "/usr/bin",
      MINECRAFT_BOT_EMAIL: "pilot@example.com",
      MINECRAFT_AUTH_CACHE_DIR: "/private/pilot",
      MINECRAFT_RCON_PASSWORD: "placeholder",
    }),
  ).toEqual({
    MINECRAFT_BOT_EMAIL: "pilot@example.com",
    MINECRAFT_AUTH_CACHE_DIR: "/private/pilot",
    MINECRAFT_RCON_PASSWORD: "placeholder",
  });
});

it("rejects invalid or expanded account settings", async () => {
  const file = Bun.file(PILOT_FILE);
  const original = await file.text();
  const replacement = original.replace(
    '"maxCompanions": 1',
    '"maxCompanions": 2',
  );
  const path = `${Bun.env["TMPDIR"] ?? "/tmp"}/storm-pilot-invalid-${crypto.randomUUID()}.json`;
  try {
    await Bun.write(path, replacement);
    await expect(loadPilotConfig(path)).rejects.toThrow();
  } finally {
    await Bun.file(path).delete();
  }
});
