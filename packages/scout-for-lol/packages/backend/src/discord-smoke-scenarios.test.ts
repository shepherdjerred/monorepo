import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { afterEach, expect, test } from "vitest";
import {
  addFlagOverride,
  clearFlagOverrides,
  getFlag,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { applyDiscordSmokeScenario } from "#src/discord-smoke-scenarios.ts";

const SMOKE_GUILD = DiscordGuildIdSchema.parse("100000000000000001");
const OTHER_GUILD = DiscordGuildIdSchema.parse("100000000000000002");

afterEach(() => {
  resetFlagOverrides("betting_enabled");
  resetFlagOverrides("bucks_transfers_enabled");
});

test("enables only transfer flags in the explicit smoke guild", () => {
  clearFlagOverrides("betting_enabled");
  clearFlagOverrides("bucks_transfers_enabled");
  applyDiscordSmokeScenario("bb-transfer", SMOKE_GUILD);

  expect(getFlag("betting_enabled", { server: SMOKE_GUILD })).toBe(true);
  expect(getFlag("bucks_transfers_enabled", { server: SMOKE_GUILD })).toBe(
    true,
  );
  expect(getFlag("betting_enabled", { server: OTHER_GUILD })).toBe(false);
  expect(getFlag("bucks_transfers_enabled", { server: OTHER_GUILD })).toBe(
    false,
  );
});

test("gateway scenario adds no feature overrides", () => {
  clearFlagOverrides("betting_enabled");
  clearFlagOverrides("bucks_transfers_enabled");
  addFlagOverride("betting_enabled", false, { server: SMOKE_GUILD });
  applyDiscordSmokeScenario("gateway", SMOKE_GUILD);

  expect(getFlag("betting_enabled", { server: SMOKE_GUILD })).toBe(false);
  expect(getFlag("bucks_transfers_enabled", { server: SMOKE_GUILD })).toBe(
    false,
  );
});
