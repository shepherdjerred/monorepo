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
 * Default-branch OpenTofu applies, and the admission token that gates them.
 *
 * Every step here mutates a live external control plane, so each one first
 * asks whether this build is still the one allowed to release. A build that
 * has been superseded by newer commits on the default branch stops rather than
 * applying a revision the repository has already moved past.
 *
 * Only the applies that depend on nothing but admission are here. The
 * seaweedfs/tailscale/arr chain waits on helm-push and the cloudflare apply
 * waits on argocd-sync, so those land with the release chain.
 */

/**
 * Stop unless this build still holds the release admission.
 *
 * `superseded` is a clean no-op exit: a newer build will do the work. Any
 * other unexpected value is a hard failure -- silently continuing would apply
 * infrastructure changes without knowing whether this build was entitled to.
 */
function admissionGate(): string[] {
  return [
    'release_admission="$(bun --no-install scripts/ci/homelab-release-admission.ts consume)"',
    'if [ "$release_admission" = "superseded" ]; then exit 0; fi',
    'if [ "$release_admission" != "admitted" ]; then',
    '  echo "invalid homelab release admission outcome: $release_admission" >&2',
    "  exit 1",
    "fi",
  ];
}

function applyCommands(stack: string): string[] {
  return [
    ...admissionGate(),
    ". ci/scripts/toolchain.sh",
    "ci/scripts/bun-install.sh --frozen-lockfile --filter homelab --production",
    `export TF_PLUGIN_CACHE_DIR=${TOFU_PLUGIN_CACHE.path}`,
    `flock -x ${TOFU_PLUGIN_CACHE.path}/.lock bun --no-install packages/homelab/scripts/tofu/tofu-stack.ts ${stack} apply`,
  ];
}

/**
 * Key every state-encrypting stack reads its passphrase from.
 *
 * Named once rather than repeated per stack: each stack keeps its own
 * 1Password item, but they all spell the field the same way.
 */
const STATE_PASSPHRASE_KEY = "TOFU_STATE_ENCRYPTION_PASSPHRASE";

const TOFU_CHANGED = {
  include: [
    ...GLOBAL_SELECTOR_INPUTS,
    "packages/homelab/scripts/tofu/**",
    "packages/homelab/src/tofu/**",
  ],
} as const;

/**
 * Platform credential stacks.
 *
 * They share one serialization group because they all write credentials into
 * the same 1Password vault and cluster namespace; running two at once would
 * race on that shared destination rather than on their own providers.
 */
const PLATFORM_APPLIES: readonly {
  readonly stack: string;
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
    stack: "openrouter",
    secrets: [
      grant("openrouter-tofu-credentials", "OPENROUTER_MANAGEMENT_KEY"),
      grant("openrouter-tofu-credentials", "OPENROUTER_BYOK_KEYS_JSON"),
      grant("openrouter-tofu-credentials", STATE_PASSPHRASE_KEY),
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
      "bun --no-install scripts/ci/homelab-release-admission.ts admit",
    ],
    timeoutMinutes: 10,
    resources: LIGHT_TIER,
    defaultBranchOnly: true,
    secrets: [GITHUB_DOWNLOAD, ...STATE_BACKEND, ...HANDOFF_KEYS],
  };
}

export function tofuApplySteps(images: CiImages): CiStep[] {
  const standalone: CiStep[] = [
    {
      key: "tofu-apply-github",
      label: "tofu apply github",
      image: images.base,
      commands: applyCommands("github"),
      dependsOn: ["homelab-release-admission"],
      timeoutMinutes: 60,
      resources: MEDIUM_TIER,
      defaultBranchOnly: true,
      concurrency: { limit: 1, group: "tofu-github" },
      changed: TOFU_CHANGED,
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
      commands: applyCommands("posthog"),
      dependsOn: ["homelab-release-admission"],
      timeoutMinutes: 60,
      resources: MEDIUM_TIER,
      defaultBranchOnly: true,
      concurrency: { limit: 1, group: "tofu-posthog" },
      changed: {
        include: [
          ...GLOBAL_SELECTOR_INPUTS,
          "packages/homelab/scripts/tofu/**",
          "packages/homelab/src/tofu/posthog/**",
        ],
      },
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

  const platform: CiStep[] = PLATFORM_APPLIES.map(({ stack, secrets }) => ({
    key: `tofu-platform-${stack}`,
    label: `tofu apply ${stack}`,
    image: images.base,
    commands: applyCommands(stack),
    dependsOn: ["homelab-release-admission"],
    timeoutMinutes: 60,
    resources: MEDIUM_TIER,
    defaultBranchOnly: true,
    concurrency: { limit: 1, group: "tofu-platform-credentials" },
    changed: TOFU_CHANGED,
    secrets: [GITHUB_DOWNLOAD, ...STATE_BACKEND, ...HANDOFF_KEYS, ...secrets],
    volumes: [TOFU_PLUGIN_CACHE],
  }));

  return [...standalone, ...platform];
}
