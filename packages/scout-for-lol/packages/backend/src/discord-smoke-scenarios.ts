import { z } from "zod";

export const DiscordSmokeScenarioNameSchema = z.enum(["gateway"]);
export type DiscordSmokeScenarioName = z.infer<
  typeof DiscordSmokeScenarioNameSchema
>;

export function discordSmokeStaticOverrides(
  _scenario: DiscordSmokeScenarioName,
): Record<string, boolean> {
  return {};
}
