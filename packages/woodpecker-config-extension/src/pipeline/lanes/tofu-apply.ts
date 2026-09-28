import { z } from "zod";
import type { CiImages } from "#src/images.ts";
import type { CiStep, SecretGrant } from "#src/pipeline/model.ts";
import { LIGHT_TIER, MEDIUM_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";
import {
  GITHUB_DOWNLOAD,
  STATE_BACKEND,
  TOFU_PLUGIN_CACHE,
  grant,
  HANDOFF_KEYS,
} from "#src/pipeline/lanes/tofu.ts";

/**
 * Default-branch OpenTofu work, and the admission token that gates it.
 *
 * Applies mutate live external control planes. Platform credential stacks
 * only plan on ordinary main builds; targeted manual builds prepare and later
 * apply one reviewed, encrypted plan. Every step here first asks whether this build
 * is still the one allowed to release.
 *
 * The standalone work that depends on nothing but admission is here. The
 * seaweedfs/tailscale/arr chain waits on helm-push and the cloudflare apply
 * waits on argocd-sync, so those land with the release chain.
 */

/**
 * Stop unless this build still holds the release admission.
 *
 * Install before reading the handoff: every workflow has fresh node_modules,
 * and the reader imports a package from the root scripts' production closure.
 *
 * `superseded` is a clean no-op exit: a newer build will do the work. Any
 * other unexpected value is a hard failure -- silently continuing would apply
 * infrastructure changes without knowing whether this build was entitled to.
 */
function admissionGate(): string[] {
  return [
    "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --filter homelab --production",
    'release_admission="$(bun --no-install scripts/ci/homelab-release-admission.ts consume)"',
    'if [ "$release_admission" = "superseded" ]; then exit 0; fi',
    'if [ "$release_admission" != "admitted" ]; then',
    '  echo "invalid homelab release admission outcome: $release_admission" >&2',
    "  exit 1",
    "fi",
  ];
}

function stackCommands(
  stack: string,
  action: "plan" | "apply" | "prepare" | "apply-saved",
  sourcePipeline?: string,
): string[] {
  return [
    ...admissionGate(),
    ...(action === "prepare" || action === "apply-saved"
      ? [
          "bun --no-install scripts/ci/homelab-release-admission.ts require-current",
        ]
      : []),
    ". ci/scripts/toolchain.sh",
    ...(stack === "github" && action === "apply"
      ? [
          'ruleset_readiness="$(bun --no-install packages/homelab/scripts/tofu/github-ruleset-ready.ts)"',
          'if [ "$ruleset_readiness" = "deferred" ]; then echo "GitHub ruleset apply deferred until a Woodpecker PR completes"; exit 0; fi',
          'if [ "$ruleset_readiness" != "ready" ]; then echo "invalid GitHub ruleset readiness result" >&2; exit 1; fi',
        ]
      : []),
    `export TF_PLUGIN_CACHE_DIR=${TOFU_PLUGIN_CACHE.path}`,
    ...(sourcePipeline === undefined
      ? []
      : [`export TOFU_PLATFORM_PLAN_PIPELINE=${sourcePipeline}`]),
    `flock -x ${TOFU_PLUGIN_CACHE.path}/.lock bun --no-install packages/homelab/scripts/tofu/tofu-stack.ts ${stack} ${action}`,
  ];
}

/**
 * Key every state-encrypting stack reads its passphrase from.
 *
 * Named once rather than repeated per stack: each stack keeps its own
 * 1Password item, but they all spell the field the same way.
 */
const STATE_PASSPHRASE_KEY = "TOFU_STATE_ENCRYPTION_PASSPHRASE";

export const PlatformApplyStackSchema = z.enum([
  "openai",
  "anthropic",
  "discord",
  "cloudflare-tokens",
] as const);

export type PlatformApplyStack = z.infer<typeof PlatformApplyStackSchema>;

export type PlatformOperation = {
  readonly stack: PlatformApplyStack;
  readonly action: "prepare" | "apply-saved";
  readonly sourcePipeline?: string;
};

function stackChanged(stack: string, platform = false) {
  return {
    include: [
      ...GLOBAL_SELECTOR_INPUTS,
      "packages/homelab/scripts/tofu/**",
      ...(platform
        ? ["packages/homelab/scripts/platform-desired-state.ts"]
        : []),
      `packages/homelab/src/tofu/${stack}/**`,
      ...(platform
        ? ["packages/homelab/src/tofu/platform-desired-state.schema.json"]
        : []),
    ],
  };
}

/**
 * Platform credential stacks.
 *
 * They share one serialization group to bound CI resource use while plans
 * read their separate live states and provider APIs.
 */
const PLATFORM_PLANS: readonly {
  readonly stack: PlatformApplyStack;
  readonly secrets: readonly SecretGrant[];
}[] = [
  {
    stack: "openai",
    secrets: [
      grant("openai-tofu-credentials", "OPENAI_ADMIN_KEY"),
      grant("openai-tofu-credentials", "OPENAI_CERTIFICATE_VALUES_JSON"),
      grant("openai-tofu-credentials", STATE_PASSPHRASE_KEY),
    ],
  },
  {
    stack: "anthropic",
    secrets: [
      grant("anthropic-tofu-credentials", "ANTHROPIC_ADMIN_API_KEY"),
      grant("anthropic-tofu-credentials", STATE_PASSPHRASE_KEY),
    ],
  },
  {
    stack: "discord",
    secrets: [
      grant("discord-tofu-credentials", STATE_PASSPHRASE_KEY),
      grant(
        "discord-birmel-credentials",
        "DISCORD_TOKEN",
        "DISCORD_BIRMEL_BOT_TOKEN",
      ),
      grant(
        "discord-starlight-beta-credentials",
        "DISCORD_TOKEN",
        "DISCORD_STARLIGHT_BETA_BOT_TOKEN",
      ),
      grant(
        "discord-starlight-prod-credentials",
        "DISCORD_TOKEN",
        "DISCORD_STARLIGHT_PROD_BOT_TOKEN",
      ),
      grant(
        "discord-scout-beta-credentials",
        "DISCORD_TOKEN",
        "DISCORD_SCOUT_BETA_BOT_TOKEN",
      ),
      grant(
        "discord-scout-prod-credentials",
        "DISCORD_TOKEN",
        "DISCORD_SCOUT_PROD_BOT_TOKEN",
      ),
      grant(
        "discord-minecraft-credentials",
        "DISCORD_BOT_TOKEN",
        "DISCORD_MINECRAFT_BOT_TOKEN",
      ),
    ],
  },
  {
    stack: "cloudflare-tokens",
    secrets: [
      grant("cloudflare-tokens-tofu-credentials", "CLOUDFLARE_API_TOKEN"),
      grant("cloudflare-tokens-tofu-credentials", STATE_PASSPHRASE_KEY),
    ],
  },
];

export function releaseAdmissionStep(images: CiImages): CiStep {
  return {
    key: "homelab-release-admission",
    label: "homelab release admission",
    image: images.base,
    commands: [
      "ci/scripts/bun-install.sh --frozen-lockfile --filter '@shepherdjerred/root-scripts' --production",
      "bun --no-install scripts/ci/homelab-release-admission.ts admit",
    ],
    timeoutMinutes: 10,
    resources: LIGHT_TIER,
    defaultBranchOnly: true,
    secrets: [GITHUB_DOWNLOAD, ...STATE_BACKEND, ...HANDOFF_KEYS],
  };
}

export function tofuApplySteps(
  images: CiImages,
  platformOperation?: PlatformOperation,
): CiStep[] {
  const standalone: CiStep[] = [
    {
      key: "tofu-apply-github",
      label: "tofu apply github",
      image: images.base,
      commands: stackCommands("github", "apply"),
      dependsOn: ["homelab-release-admission"],
      timeoutMinutes: 60,
      resources: MEDIUM_TIER,
      defaultBranchOnly: true,
      concurrency: { limit: 1, group: "tofu-github" },
      changed: stackChanged("github"),
      secrets: [
        GITHUB_DOWNLOAD,
        ...STATE_BACKEND,
        ...HANDOFF_KEYS,
        grant("ci-github-credentials", "TOFU_GITHUB_TOKEN"),
      ],
      volumes: [TOFU_PLUGIN_CACHE],
    },
    {
      key: "tofu-posthog",
      label: "tofu apply posthog",
      image: images.base,
      commands: stackCommands("posthog", "apply"),
      dependsOn: ["homelab-release-admission"],
      timeoutMinutes: 60,
      resources: MEDIUM_TIER,
      defaultBranchOnly: true,
      concurrency: { limit: 1, group: "tofu-posthog" },
      changed: stackChanged("posthog"),
      secrets: [
        GITHUB_DOWNLOAD,
        ...STATE_BACKEND,
        ...HANDOFF_KEYS,
        grant(
          "posthog-tofu-credentials",
          "POSTHOG_API_KEY",
          "POSTHOG_CLI_API_KEY",
        ),
        grant("posthog-tofu-credentials", "POSTHOG_TOFU_STATE_PASSPHRASE"),
      ],
      volumes: [TOFU_PLUGIN_CACHE],
    },
  ];

  const platform: CiStep[] = PLATFORM_PLANS.map(({ stack, secrets }) => ({
    key: `tofu-platform-${stack}`,
    label: `tofu ${stack === platformOperation?.stack ? platformOperation.action : "plan"} ${stack}`,
    image: images.base,
    commands: stackCommands(
      stack,
      stack === platformOperation?.stack ? platformOperation.action : "plan",
      stack === platformOperation?.stack
        ? platformOperation.sourcePipeline
        : undefined,
    ),
    dependsOn: ["homelab-release-admission"],
    timeoutMinutes: 60,
    resources: MEDIUM_TIER,
    defaultBranchOnly: true,
    concurrency: { limit: 1, group: "tofu-platform-credentials" },
    changed: stackChanged(stack, true),
    secrets: [GITHUB_DOWNLOAD, ...STATE_BACKEND, ...HANDOFF_KEYS, ...secrets],
    volumes: [TOFU_PLUGIN_CACHE],
  }));

  return [...standalone, ...platform];
}
