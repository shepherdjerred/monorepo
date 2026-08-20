import { optionalEnv } from "./run.ts";

export const DISABLED_ACTIVITY_CLIENT_ID = "000000000000000000";

export function activityClientId(
  flavor: "prod" | "beta",
  dryRun: boolean,
): string {
  const variable = `SCOUT_CUSTOMS_${flavor === "prod" ? "PROD" : "BETA"}_DISCORD_CLIENT_ID`;
  const value = optionalEnv(variable);
  if (value !== null) return value;
  if (dryRun) return DISABLED_ACTIVITY_CLIENT_ID;
  throw new Error(`${variable} is required for a real ${flavor} site build`);
}
