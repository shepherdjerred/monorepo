import { fileURLToPath } from "node:url";
import { env } from "node:process";
import { z } from "zod";

export function recordedBuildDirectory() {
  const name = z
    .string()
    .regex(/^[a-z\d][a-z\d-]{0,79}$/, "Expected a cache directory name")
    .parse(
      env["SCOUT_REPLAY_E2E_BUILD_NAME"] ?? "scout-recorded-replay-e2e-dist",
    );
  return fileURLToPath(
    new URL(`../../../../../../.cache/${name}`, import.meta.url),
  );
}
