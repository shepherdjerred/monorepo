export const legacyTofuPaths = [
  "packages/homelab/scripts/tofu-stack-manifest.ts",
  "packages/homelab/src/tofu/argocd",
  "packages/homelab/src/tofu/arr",
  "packages/homelab/src/tofu/asuswrt",
  "packages/homelab/src/tofu/buildkite",
  "packages/homelab/src/tofu/cloudflare",
  "packages/homelab/src/tofu/github",
  "packages/homelab/src/tofu/pagerduty",
  "packages/homelab/src/tofu/seaweedfs",
  "packages/homelab/src/tofu/tailscale",
] as const;

export const platformTofuPaths = [
  "packages/homelab/scripts/tofu-stack-manifest.ts",
  "packages/homelab/src/tofu/anthropic",
  "packages/homelab/src/tofu/cloudflare-tokens",
  "packages/homelab/src/tofu/discord",
  "packages/homelab/src/tofu/openai",
  "packages/homelab/src/tofu/openrouter",
  "packages/homelab/src/tofu/platform-desired-state.schema.json",
  "packages/homelab/scripts/platform-desired-state.ts",
  "packages/homelab/src/cdk8s/src/resources/argo-applications/ci/buildkite.ts",
  "packages/homelab/src/cdk8s/onepassword-vault-snapshot.json",
] as const;

export const platformTofuStacks = [
  "openai",
  "anthropic",
  "discord",
  "openrouter",
  "cloudflare-tokens",
] as const;

export type PlatformTofuStack = (typeof platformTofuStacks)[number];

export function requestedPlatformTofuApply(
  environment: Readonly<Record<string, string | undefined>>,
): PlatformTofuStack | undefined {
  const requested = environment["TOFU_PLATFORM_APPLY"];
  if (requested === undefined || requested.length === 0) return undefined;
  for (const stack of platformTofuStacks) {
    if (requested === stack) {
      const defaultBranch =
        environment["BUILDKITE_PIPELINE_DEFAULT_BRANCH"] ?? "main";
      const branch = environment["BUILDKITE_BRANCH"];
      if (branch !== defaultBranch) {
        throw new Error(
          `TOFU_PLATFORM_APPLY is ${defaultBranch}-only; BUILDKITE_BRANCH was ${branch ?? "unset"}`,
        );
      }
      return stack;
    }
  }
  throw new Error(
    `TOFU_PLATFORM_APPLY must be one of ${platformTofuStacks.join(", ")}`,
  );
}
