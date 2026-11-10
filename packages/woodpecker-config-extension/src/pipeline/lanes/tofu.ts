import type { CiImages } from "#src/images.ts";
import type { CiStep, SecretGrant } from "#src/pipeline/model.ts";
import { LIGHT_TIER, MEDIUM_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";

export const TOFU_PLUGIN_CACHE = {
  claim: "woodpecker-tofu-plugin-cache",
  path: "/woodpecker/tofu-plugin-cache",
} as const;

export const GITHUB_DOWNLOAD: SecretGrant = {
  secret: "ci-github-credentials",
  key: "GITHUB_DOWNLOAD_TOKEN",
  env: "GITHUB_DOWNLOAD_TOKEN",
};

/** Artifact publication uses only the dedicated immutable-archive bucket identity. */
export const DELIVERY_ARCHIVE_KEYS: SecretGrant[] = [
  {
    secret: "ci-delivery-archive-credentials",
    key: "DELIVERY_ARCHIVE_PUBLISHER_ACCESS_KEY_ID",
    env: "DELIVERY_ARCHIVE_PUBLISHER_ACCESS_KEY_ID",
  },
  {
    secret: "ci-delivery-archive-credentials",
    key: "DELIVERY_ARCHIVE_PUBLISHER_SECRET_ACCESS_KEY",
    env: "DELIVERY_ARCHIVE_PUBLISHER_SECRET_ACCESS_KEY",
  },
];

/** Build-scoped handoffs and build outputs have no deployment or remote-state authority. */
export const HANDOFF_KEYS: SecretGrant[] = [
  {
    secret: "ci-seaweedfs-credentials",
    key: "SEAWEEDFS_HANDOFF_ACCESS_KEY_ID",
    env: "SEAWEEDFS_HANDOFF_ACCESS_KEY_ID",
  },
  {
    secret: "ci-seaweedfs-credentials",
    key: "SEAWEEDFS_HANDOFF_SECRET_ACCESS_KEY",
    env: "SEAWEEDFS_HANDOFF_SECRET_ACCESS_KEY",
  },
];

export function grant(secret: string, key: string, env = key): SecretGrant {
  return { secret, key, env };
}

/**
 * Every stack under packages/homelab/src/tofu; select.test.ts compares this
 * with the directories on disk, so a new stack cannot go unvalidated.
 * Validation is offline and holds no credential, so operator-only stacks
 * (anthropic-federation, argocd, google) and the LAN-only asuswrt stack are
 * validated like the rest.
 */
export const VALIDATED_STACKS = [
  "anthropic",
  "anthropic-federation",
  "application-secrets",
  "argocd",
  "arr",
  "asuswrt",
  "backblaze",
  "cloudflare",
  "cloudflare-tokens",
  "discord",
  "dockerhub",
  "dockerhub-tokens",
  "github",
  "google",
  "openai",
  "posthog",
  "seaweedfs",
  "tailscale",
] as const;

/**
 * Workspaces the validation step installs. A filtered production install
 * gives only these and their production workspace dependencies a
 * node_modules, so this must cover every workspace whose files
 * tofu-stack.ts and the cdktn scripts load at runtime. @homelab/cdk8s is
 * one: credential-handoff.ts imports its 1Password field map.
 * test/lanes/tofu-install.test.ts derives that set from the import graph.
 */
export const TOFU_VALIDATION_INSTALL_FILTERS = [
  "homelab",
  "@homelab/cdktn",
  "@homelab/cdk8s",
] as const;

/** CI validates configuration offline. Operational plans and applies run in Delivery. */
export function tofuValidationSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "tofu-validate",
      label: "validate infrastructure configuration",
      image: images.base,
      commands: [
        "MISE_TOOLCHAIN_SCOPE=tofu . ci/scripts/toolchain.sh",
        `ci/scripts/bun-install.sh --frozen-lockfile ${TOFU_VALIDATION_INSTALL_FILTERS.map((name) => `--filter '${name}'`).join(" ")} --production`,
        // Synthesized stacks: regenerate the provider bindings, then fail when
        // a committed main.tf.json differs from a fresh synthesis. This runs
        // before the shared plugin cache is selected, which only the locked
        // validations below may write.
        "bun --no-install run --cwd packages/homelab-cdktn generate",
        "bun --no-install run --cwd packages/homelab-cdktn build",
        `export TF_PLUGIN_CACHE_DIR=${TOFU_PLUGIN_CACHE.path}`,
        `for stack in ${VALIDATED_STACKS.join(" ")}; do`,
        `  flock -x ${TOFU_PLUGIN_CACHE.path}/.lock bun --no-install packages/homelab/scripts/tofu/tofu-stack.ts "$stack" validate`,
        "done",
      ],
      timeoutMinutes: 60,
      resources: MEDIUM_TIER,
      events: ["pull_request"],
      changed: {
        include: [
          ...GLOBAL_SELECTOR_INPUTS,
          "packages/homelab-cdktn/**",
          "packages/homelab/scripts/tofu/**",
          "packages/homelab/src/tofu/**",
          // asuswrt validates against the provider built from this source.
          "packages/terraform-provider-asuswrt/**",
        ],
      },
      secrets: [GITHUB_DOWNLOAD],
      volumes: [TOFU_PLUGIN_CACHE],
    },
  ];
}

/**
 * Every stack's exact source, frozen as an immutable archive on every main
 * run. Delivery selects a stack's archive by digest, so CI never guesses from
 * changed paths, and the step holds only the archive-publisher and handoff
 * identities: no provider or remote-state credential, no plan, no apply.
 */
export function tofuArchiveSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "tofu-archives",
      label: "publish infrastructure archives",
      image: images.base,
      commands: [
        "MISE_TOOLCHAIN_SCOPE=deployment . ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --filter homelab --production",
        "bun --no-install scripts/ci/publish-tofu-archives.ts",
        "bun --no-install scripts/ci/write-tofu-archive-handoff.ts",
      ],
      dependsOn: ["verify"],
      timeoutMinutes: 15,
      resources: LIGHT_TIER,
      defaultBranchOnly: true,
      concurrency: { limit: 1, group: "tofu-archives" },
      secrets: [GITHUB_DOWNLOAD, ...DELIVERY_ARCHIVE_KEYS, ...HANDOFF_KEYS],
    },
  ];
}
