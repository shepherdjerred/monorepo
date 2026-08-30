import { optionalEnv, requireEnv } from "./run.ts";

export function scoutStorageRoot(): string {
  return new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
}

export function requireScoutStorageCredentials(dryRun: boolean): void {
  if (
    !dryRun &&
    (optionalEnv("AWS_ACCESS_KEY_ID") === null ||
      optionalEnv("AWS_SECRET_ACCESS_KEY") === null)
  ) {
    requireEnv("AWS_ACCESS_KEY_ID");
    requireEnv("AWS_SECRET_ACCESS_KEY");
  }
}
