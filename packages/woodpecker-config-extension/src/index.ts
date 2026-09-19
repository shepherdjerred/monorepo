import type { KeyObject } from "node:crypto";
import { createApp } from "#src/app.ts";
import { fetchPublicKey } from "#src/signature.ts";
import { createRawFetcher } from "#src/images.ts";

function requireEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

const serverUrl = requireEnv("WOODPECKER_SERVER_URL");
const repoSlug = requireEnv("CI_REPO_SLUG");
const port = Number(Bun.env["PORT"] ?? "3000");

/**
 * Cache the signing key, but never cache a failure.
 *
 * The key is stable for the life of a Woodpecker instance. Memoizing a
 * rejected fetch would leave the extension permanently unable to verify
 * anything after one transient blip, so only a resolved promise is kept.
 */
let cachedKey: KeyObject | undefined;
async function publicKey(): Promise<KeyObject> {
  if (cachedKey !== undefined) return cachedKey;
  const key = await fetchPublicKey(serverUrl);
  cachedKey = key;
  return key;
}

const app = createApp({
  publicKey,
  imageFetcher: createRawFetcher(repoSlug),
});

export default { port, fetch: app.fetch };
