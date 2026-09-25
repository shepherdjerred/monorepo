import type { KeyObject } from "node:crypto";
import { createApp } from "#src/app.ts";
import { fetchPublicKey } from "#src/signature.ts";
import { createRawFetcher } from "#src/images.ts";
import {
  lastCommitWithSuccessfulWorkflows,
  lastSuccessfulCommit,
} from "#src/woodpecker-api.ts";

function requireEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

// WOODPECKER_URL, not WOODPECKER_SERVER: upstream gives that name two
// meanings (the CLI's HTTP address, the agent's gRPC endpoint), so this
// repository keeps the HTTP origin under a name with exactly one.
const serverUrl = requireEnv("WOODPECKER_URL");
const repoSlug = requireEnv("CI_REPO_SLUG");
const apiToken = requireEnv("WOODPECKER_API_TOKEN");
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
  changedBase: (repoId, branch) =>
    lastSuccessfulCommit(repoId, branch, {
      baseUrl: serverUrl,
      token: apiToken,
    }),
  // The image lane's base must be a commit whose images were built, pushed
  // AND pinned -- the two workflows named here.
  imageReleaseBase: (repoId, branch) =>
    lastCommitWithSuccessfulWorkflows(
      repoId,
      branch,
      ["images", "version-commit-back"],
      { baseUrl: serverUrl, token: apiToken },
    ),
});

export default { port, fetch: app.fetch };
