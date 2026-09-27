import { expect, it } from "vitest";
import { loadBootstrap, loadPilotConfig } from "./config.ts";

it("ships disabled with one pilot account and a two-hour Pacific window", async () => {
  const config = await loadPilotConfig(
    new URL("../pilot.json", import.meta.url).pathname,
  );
  expect(config.enabled).toBe(false);
  expect(config.maxCompanions).toBe(1);
  expect([config.startHour, config.endHour]).toEqual([18, 20]);
  expect(config.llmEnabled).toBe(false);
  expect(config.llmModel).toBe("gpt-6-luna");
  expect(config.monthlyBudgetUsd).toBe(20);
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
  const file = Bun.file(new URL("../pilot.json", import.meta.url).pathname);
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
