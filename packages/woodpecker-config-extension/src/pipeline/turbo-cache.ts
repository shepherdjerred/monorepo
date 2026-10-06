import type { CiStep, SecretGrant } from "#src/pipeline/model.ts";

/** Shared remote-cache endpoint. The signing pass adds its trust namespace. */
export const TURBO_REMOTE_CACHE_ENVIRONMENT = {
  TURBO_API: "https://turbo-cache.tailnet-1a49.ts.net",
} as const;

const TURBO_CACHE_TEAMS = {
  trusted: "monorepo",
  "pull-request": "monorepo-pull-request",
} as const;

export const TURBO_CACHE_TOKEN: SecretGrant = {
  secret: "ci-turbo-cache-credentials",
  key: "TURBO_TOKEN",
  env: "TURBO_TOKEN",
};

const TURBO_SIGNATURE_SECRET = "ci-turbo-cache-credentials";

export function turboCacheSignatureKey(
  trustDomain: "trusted" | "pull-request",
): SecretGrant {
  return {
    secret: TURBO_SIGNATURE_SECRET,
    key:
      trustDomain === "trusted"
        ? "TURBO_REMOTE_CACHE_SIGNATURE_KEY_TRUSTED"
        : "TURBO_REMOTE_CACHE_SIGNATURE_KEY_PR",
    env: "TURBO_REMOTE_CACHE_SIGNATURE_KEY",
  };
}

/** Attach exactly one signing domain to each step that can reach remote cache. */
export function signRemoteCacheSteps(
  steps: readonly CiStep[],
  trustDomain: "trusted" | "pull-request",
): CiStep[] {
  return steps.map((step) => {
    const usesRemoteCache = step.secrets?.some(
      (grant) => grant.env === TURBO_CACHE_TOKEN.env,
    );
    if (usesRemoteCache !== true) return step;
    return {
      ...step,
      environment: {
        ...step.environment,
        TURBO_TEAM: TURBO_CACHE_TEAMS[trustDomain],
      },
      secrets: [...(step.secrets ?? []), turboCacheSignatureKey(trustDomain)],
    };
  });
}
