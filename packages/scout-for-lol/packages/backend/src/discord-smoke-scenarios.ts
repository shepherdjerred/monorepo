import type { DiscordGuildId } from "@scout-for-lol/data";
import { z } from "zod";
import { addFlagOverride } from "#src/configuration/flags.ts";

export const DiscordSmokeScenarioNameSchema = z.enum([
  "gateway",
  "bb-transfer",
]);
export type DiscordSmokeScenarioName = z.infer<
  typeof DiscordSmokeScenarioNameSchema
>;

export function applyDiscordSmokeScenario(
  scenario: DiscordSmokeScenarioName,
  guildId: DiscordGuildId,
): void {
  switch (scenario) {
    case "gateway":
      return;
    case "bb-transfer":
      addFlagOverride("betting_enabled", true, { server: guildId });
      addFlagOverride("bucks_transfers_enabled", true, { server: guildId });
  }
}

export function discordSmokeStaticOverrides(
  _scenario: DiscordSmokeScenarioName,
): Record<string, boolean> {
  return {};
}
