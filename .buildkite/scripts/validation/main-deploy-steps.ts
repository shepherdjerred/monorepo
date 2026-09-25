/**
 * Main-only deploy and publish steps. They already wait on their own
 * depends_on, so they must not also cancel when an unrelated lane fails.
 */
export const MAIN_DEPLOY_STEPS = [
  "images",
  "macos-cross-compiler",
  "sites",
  "publish",
  "trmnl-publish",
  "tofu-apply-seaweedfs",
  "tofu-apply-tailscale",
  "tofu-apply-buildkite",
  "tofu-apply-arr",
  "tofu-apply-github",
  "tofu-apply-cloudflare",
  "tofu-posthog",
  "tofu-platform-openai",
  "tofu-platform-anthropic",
  "tofu-platform-discord",
  "tofu-platform-openrouter",
  "tofu-platform-cloudflare-tokens",
  "release-please",
  "version-commit-back",
  "ci-base-refresh",
  "ci-playwright-refresh",
  "windows-cross-compiler-refresh",
] as const;
