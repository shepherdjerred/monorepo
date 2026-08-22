import { optionalEnv } from "./run.ts";

export const DISABLED_ACTIVITY_CLIENT_ID = "000000000000000000";

const ACTIVITY_CLIENT_IDS = {
  beta: "1311755320745394317",
  prod: "1182800769188110366",
} as const;

export function activityClientId(
  flavor: "prod" | "beta",
  dryRun: boolean,
): string {
  const variable = `SCOUT_CUSTOMS_${flavor === "prod" ? "PROD" : "BETA"}_DISCORD_CLIENT_ID`;
  const value = optionalEnv(variable);
  if (value !== null) return value;
  if (dryRun) return DISABLED_ACTIVITY_CLIENT_ID;
  return ACTIVITY_CLIENT_IDS[flavor];
}
