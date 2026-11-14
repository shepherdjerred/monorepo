export const legacyTofuPaths = [
  // The CDK Terrain app that synthesizes src/tofu/<stack>/main.tf.json, and
  // the provider pins its bindings and every lock file follow.
  "packages/homelab-cdktn",
  "packages/homelab/src/tofu/provider-versions.json",
  // The registries the cloudflare stack is synthesized from: a change to one
  // must re-run the "synth is current" check and the stack's validation.
  "packages/homelab/src/domain-registry.json",
  "packages/homelab/src/domain-registry.ts",
  "packages/homelab/src/platform-model.json",
  "packages/homelab/src/platform-model.ts",
  "packages/homelab/scripts/tofu/tofu-stack-manifest.ts",
  "packages/homelab/src/tofu/argocd",
  "packages/homelab/src/tofu/arr",
  "packages/homelab/src/tofu/asuswrt",
  "packages/homelab/src/tofu/cloudflare",
  "packages/homelab/src/tofu/github",
  "packages/homelab/src/tofu/seaweedfs",
  "packages/homelab/src/tofu/tailscale",
] as const;

export const platformTofuPaths = [
  // Platform stacks are synthesized from the same CDK Terrain app once ported.
  "packages/homelab-cdktn",
  "packages/homelab/src/tofu/provider-versions.json",
  "packages/homelab/scripts/tofu/tofu-stack-manifest.ts",
  "packages/homelab/src/tofu/anthropic",
  "packages/homelab/src/tofu/anthropic-federation",
  "packages/homelab/src/tofu/cloudflare-tokens",
  "packages/homelab/src/tofu/discord",
  "packages/homelab/src/tofu/google",
  "packages/homelab/src/tofu/openai",
  "packages/homelab/src/tofu/platform-desired-state.schema.json",
  "packages/homelab/scripts/platform-desired-state.ts",
  "packages/homelab/src/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts",
  "packages/homelab/src/cdk8s/onepassword-vault-snapshot.json",
] as const;
