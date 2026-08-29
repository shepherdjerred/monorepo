import type { DiscordGuildId } from "@scout-for-lol/data";
import { z } from "zod";

export const DiscordSmokeScenarioNameSchema = z.enum(["gateway"]);
export type DiscordSmokeScenarioName = z.infer<
  typeof DiscordSmokeScenarioNameSchema
>;

export function applyDiscordSmokeScenario(
  _scenario: DiscordSmokeScenarioName,
  _guildId: DiscordGuildId,
): void {
  void _scenario;
  void _guildId;
}

export function discordSmokeStaticOverrides(
  _scenario: DiscordSmokeScenarioName,
): Record<string, boolean> {
  return {};
}
