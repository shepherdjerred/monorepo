import type { KeyObject } from "node:crypto";
import { createApp } from "#src/app.ts";
import { fetchPublicKey } from "#src/signature.ts";
import { createRawFetcher } from "#src/images.ts";
import {
  lastCommitWithSuccessfulWorkflows,
  lastPipelineWithSuccessfulWorkflows,
  lastSuccessfulCommit,
} from "#src/woodpecker-api.ts";
import { hasExactHeadApproval } from "#src/github-approval.ts";
import { cancelSupersededPr } from "#src/superseded-pr.ts";
import { initFeatureFlags } from "@shepherdjerred/feature-flags";
import { sourceCacheConfig } from "#src/checkout/config.ts";
import { maintenanceConfig } from "#src/maintenance-config.ts";
import { performanceConfig } from "#src/performance-config.ts";
import {
  deliveryCatalogV2Enabled,
  deliveryPublicationEnabled,
} from "#src/delivery-config.ts";
import { requireGateImage } from "#src/gate-image.ts";

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
const approvalReadToken = requireEnv("GITHUB_APPROVAL_READ_TOKEN");
const port = Number(Bun.env["PORT"] ?? "3000");
const trustedGateImage = requireGateImage(requireEnv("CI_GATE_IMAGE"));

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

await initFeatureFlags({
  onInitializationFailure: () => {
    console.warn("CI rollout flags unavailable");
  },
});
const app = createApp({
  deliveryPublicationEnabled,
  deliveryCatalogV2Enabled,
  performanceOptions: performanceConfig,
  maintenanceEnabled: async (manual) => {
    const result = await maintenanceConfig(manual);
    return result.value;
  },
  sourceCacheEnabled: async (branch) => {
    const config = await sourceCacheConfig(branch);
    return config.value;
  },
  cancelSupersededPr: (repoId, pipeline) =>
    cancelSupersededPr(repoId, pipeline, {
      baseUrl: serverUrl,
      token: apiToken,
    }),
  trustedGateImage,
  publicKey,
  imageFetcher: createRawFetcher(repoSlug),
  changedBase: (repoId, branch) =>
    lastSuccessfulCommit(repoId, branch, {
      baseUrl: serverUrl,
      token: apiToken,
    }),
  verifyBase: (repoId, branch) =>
    lastCommitWithSuccessfulWorkflows(repoId, branch, ["verify"], {
      baseUrl: serverUrl,
      token: apiToken,
    }),
  // Retain immutable build inputs only from a fully successful producer pipeline.
  imageReleaseBase: (repoId, branch) =>
    lastPipelineWithSuccessfulWorkflows(
      repoId,
      branch,
      ["images", "helm-push"],
      { baseUrl: serverUrl, token: apiToken, requirePipelineSuccess: true },
    ),
  hostedAutomationApproved: (pipeline) =>
    hasExactHeadApproval(pipeline, {
      repo: repoSlug,
      token: approvalReadToken,
      reviewer: "shepherdjerred",
    }),
});

export default { port, fetch: app.fetch };
