/**
 * The main pipeline's build-summary tables.
 *
 * `summarySteps` is every step key the summary reports an outcome for, and
 * `summaryLanes` every change-detection lane it reports a selection for. They
 * live beside the annotator rather than in the CI selector core so a step or
 * lane added to the pipeline has one obvious place to be registered, and so
 * `ci-lane-coverage.test.ts` can assert the two lists stay in step with the
 * selector without importing the whole selector.
 */

export const summarySteps = [
  "verify",
  "hkctl-native-main",
  "quotabar-macos-main",
  "tasknotes-native-main",
  "playwright-e2e-main",
  "resume-build-main",
  "trmnl-publish",
  "docker-e2e-main",
  "images",
  "sites",
  "homelab-release-admission",
  "helm-push",
  "tofu-apply-seaweedfs",
  "tofu-apply-tailscale",
  "tofu-apply-buildkite",
  "tofu-apply-arr",
  "tofu-apply-github",
  "tofu-posthog",
  "tofu-platform-openai",
  "tofu-platform-anthropic",
  "tofu-platform-discord",
  "tofu-platform-openrouter",
  "tofu-platform-cloudflare-tokens",
  "argocd-sync",
  "scout-beta-release",
  "publish",
  "scout-tag-release",
  "scout-prod-reconcile",
  "tofu-apply-cloudflare",
  "release-please",
  "version-commit-back",
  "ci-base-refresh",
  "ci-playwright-refresh",
] as const;

export const summaryLanes = [
  "hkctl-native",
  "quotabar-macos",
  "tasknotes-native",
  "playwright",
  "resume",
  "trmnl",
  "docker-e2e",
  "images",
  "sites",
  "site-sjer-red",
  "site-resume",
  "site-webring",
  "site-cooklang",
  "site-stocks",
  "site-wiki",
  "site-better-skill-capped",
  "site-glitter",
  "site-scout",
  "helm",
  "tofu",
  "argocd",
  "helm-types",
  "tofu-posthog",
  "tofu-platforms",
  "npm",
  "cooklang",
  "scout-reconcile",
  "ci-base",
  "ci-playwright",
] as const;

export function outcomeIcon(outcome: string): string {
  return outcome === "passed" ? ":white_check_mark:" : ":x:";
}
