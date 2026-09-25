import type { CiImages } from "#src/images.ts";
import type { CiStep, SecretGrant } from "#src/pipeline/model.ts";
import { MEDIUM_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";

/**
 * OpenTofu plan lanes.
 *
 * Only the PR-side `plan` lanes are here. The `apply` lanes are main-only and
 * gated on the homelab release admission token, so they belong with the
 * release chain rather than with these.
 *
 * The stack whose name is conspicuously absent is `buildkite`: it manages the
 * Buildkite cluster and queues, and has no successor. Woodpecker keeps all of
 * its configuration in-cluster, so that stack is deleted rather than ported.
 */

/** Plugin cache claim, shared by every tofu lane. */
export const TOFU_PLUGIN_CACHE = {
  claim: "woodpecker-tofu-plugin-cache",
  path: "/woodpecker/tofu-plugin-cache",
} as const;

export const GITHUB_DOWNLOAD: SecretGrant = {
  secret: "ci-github-credentials",
  key: "GITHUB_DOWNLOAD_TOKEN",
  env: "GITHUB_DOWNLOAD_TOKEN",
};

/**
 * SeaweedFS identities, one per job this CI does.
 *
 * These are five genuinely distinct S3 identities, each scoped in SeaweedFS to
 * the buckets its job touches, not four names for one key. That distinction
 * was previously cosmetic: `SEAWEEDFS_STATE_*` and `SEAWEEDFS_DEPLOY_*` held
 * the same value, and that value was the cluster's only identity -- unscoped
 * `Admin` over every bucket. Any step granted either pair could read and write
 * the OpenTofu state, every published site, and the LLM archive alike.
 *
 * The scoping lives in SeaweedFS's identities config, which is not
 * repo-managed: it exists only in the `seaweedfs-s3-credentials` 1Password
 * item the S3 gateway loads through `existingConfigSecret`. Nothing here can
 * assert it, so the boundary is proved by probe -- each identity must be
 * denied a bucket belonging to another -- and that proof is the acceptance
 * evidence for any change to it.
 */

/** Remote state lives in SeaweedFS, so every stack reads the state keys. */
export const STATE_BACKEND: SecretGrant[] = [
  {
    secret: "ci-seaweedfs-credentials",
    key: "SEAWEEDFS_TOFU_STATE_ACCESS_KEY_ID",
    env: "SEAWEEDFS_TOFU_STATE_ACCESS_KEY_ID",
  },
  {
    secret: "ci-seaweedfs-credentials",
    key: "SEAWEEDFS_TOFU_STATE_SECRET_ACCESS_KEY",
    env: "SEAWEEDFS_TOFU_STATE_SECRET_ACCESS_KEY",
  },
];

/**
 * The identity that writes the live buckets: the published static sites and
 * the release archives. Scoped to exactly those twelve buckets, so it cannot
 * reach the OpenTofu state or the handoff store.
 */
export const DEPLOY_KEYS: SecretGrant[] = [
  {
    secret: "ci-seaweedfs-credentials",
    key: "SEAWEEDFS_SITES_ACCESS_KEY_ID",
    env: "SEAWEEDFS_SITES_ACCESS_KEY_ID",
  },
  {
    secret: "ci-seaweedfs-credentials",
    key: "SEAWEEDFS_SITES_SECRET_ACCESS_KEY",
    env: "SEAWEEDFS_SITES_SECRET_ACCESS_KEY",
  },
];

/**
 * Keys the build-scoped handoff store needs.
 *
 * Every step that reads or writes a handoff -- which includes every step that
 * consumes the release admission token -- talks to SeaweedFS. Scoped to the
 * `ci-handoff` bucket alone, which is what lets `verify`, `playwright-e2e` and
 * `resume-build` run on every pull request without holding the credential that
 * publishes sjer.red.
 *
 * Bucket-scoped rather than prefix-scoped on purpose: one bucket carries both
 * the `<pipeline>/<key>.json` handoffs and `ci-artifact`'s `artifacts/` trees,
 * and a prefix grant would break the artifact half while the handoff half kept
 * working.
 */
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

/**
 * Read-only access to the private `apple-sdks` bucket, which holds the Apple
 * SDK tarballs the macos-cross-compiler images are built from.
 *
 * Read and list only, and only that bucket: the SDKs are staged by an operator
 * from a Mac with the matching Xcode, never by CI. That is what makes it safe
 * to hand the pull-request smoke build, which the Buildkite lane it replaces
 * did with the cluster-wide deploy key instead.
 */
export const APPLE_SDKS_KEYS: SecretGrant[] = [
  {
    secret: "ci-seaweedfs-credentials",
    key: "SEAWEEDFS_APPLE_SDKS_ACCESS_KEY_ID",
    env: "SEAWEEDFS_APPLE_SDKS_ACCESS_KEY_ID",
  },
  {
    secret: "ci-seaweedfs-credentials",
    key: "SEAWEEDFS_APPLE_SDKS_SECRET_ACCESS_KEY",
    env: "SEAWEEDFS_APPLE_SDKS_SECRET_ACCESS_KEY",
  },
];

/** Shorthand for one grant; `env` defaults to the Secret's key name. */
export function grant(secret: string, key: string, env = key): SecretGrant {
  return { secret, key, env };
}

/** Provider credentials, beyond the shared state-backend grants. */
/**
 * Per-stack provider credentials.
 *
 * Exported so the apply lane names the same grants as the plan lane. Two
 * copies would let an apply run with a credential its plan never used.
 */
export const STACK_SECRETS: Readonly<Record<string, readonly SecretGrant[]>> = {
  // The only CI credential that is still unscoped, and deliberately so: this
  // stack manages the buckets themselves, and SeaweedFS requires unscoped
  // `Admin` to create one. It cannot be the site-sync identity without handing
  // that identity admin back, so it is its own -- which at least makes "who
  // can create and delete buckets" one name that can be rotated on its own.
  // It is also why `tofu-plan-seaweedfs` remains the one pull-request-reachable
  // step holding a broad SeaweedFS credential; narrowing that means moving
  // bucket management off the pull-request path.
  seaweedfs: [
    grant("ci-seaweedfs-credentials", "SEAWEEDFS_TOFU_ADMIN_ACCESS_KEY_ID"),
    grant("ci-seaweedfs-credentials", "SEAWEEDFS_TOFU_ADMIN_SECRET_ACCESS_KEY"),
  ],
  tailscale: [
    grant("ci-tailscale-credentials", "TAILSCALE_OAUTH_CLIENT_ID"),
    grant("ci-tailscale-credentials", "TAILSCALE_OAUTH_CLIENT_SECRET"),
  ],
  arr: [
    grant("ci-arr-credentials", "RADARR_API_KEY"),
    grant("ci-arr-credentials", "SONARR_API_KEY"),
    grant("ci-arr-credentials", "PROWLARR_API_KEY"),
    grant("ci-arr-credentials", "QBITTORRENT_PASSWORD"),
    grant("ci-arr-credentials", "PRIVATEHD_PASSWORD"),
    grant("ci-arr-credentials", "PRIVATEHD_PID"),
    grant("ci-arr-credentials", "AVISTAZ_PASSWORD"),
    grant("ci-arr-credentials", "AVISTAZ_PID"),
    grant("ci-arr-credentials", "ANIMEZ_PASSWORD"),
    grant("ci-arr-credentials", "ANIMEZ_PID"),
  ],
  github: [grant("ci-github-credentials", "TOFU_GITHUB_TOKEN")],
  cloudflare: [
    grant("ci-cloudflare-credentials", "CLOUDFLARE_ACCOUNT_ID"),
    grant("ci-cloudflare-credentials", "CLOUDFLARE_API_TOKEN"),
  ],
};

/**
 * Stacks whose plans run on a pull request, in order.
 *
 * They are chained rather than parallel because they share one plugin cache
 * directory, whose download protocol has no concurrent-writer support. The
 * command still takes an advisory lock; the chain keeps steps from queueing up
 * behind that lock and burning their timeout waiting.
 */
const PLAN_STACKS = [
  "seaweedfs",
  "tailscale",
  "arr",
  "github",
  "cloudflare",
] as const;

/**
 * Platform stacks: credentials for external AI and messaging control planes.
 *
 * Only validated on a pull request. Their applies are main-only and share a
 * serialization group, so they live with the release chain.
 */
const PLATFORM_STACKS = [
  "openai",
  "anthropic",
  "discord",
  "openrouter",
  "cloudflare-tokens",
] as const;

const TOFU_CHANGED = {
  include: [
    ...GLOBAL_SELECTOR_INPUTS,
    "packages/homelab/scripts/tofu/**",
    "packages/homelab/src/tofu/**",
  ],
} as const;

function tofuCommands(stack: string, action: "plan" | "apply"): string[] {
  return [
    ". ci/scripts/toolchain.sh",
    "ci/scripts/bun-install.sh --frozen-lockfile --filter homelab --production",
    `export TF_PLUGIN_CACHE_DIR=${TOFU_PLUGIN_CACHE.path}`,
    // The plugin cache protocol has no concurrent-writer support, so take an
    // advisory lock even though the lanes are chained: a rerun of one lane can
    // still overlap another build's.
    `flock -x ${TOFU_PLUGIN_CACHE.path}/.lock bun --no-install packages/homelab/scripts/tofu/tofu-stack.ts ${stack} ${action}`,
  ];
}

/**
 * Additional pull-request lanes that validate rather than plan.
 *
 * `validate` needs no provider credentials -- it checks configuration shape,
 * not live state -- so these carry only the download token and, for posthog,
 * its state keys.
 */
function tofuValidateSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "tofu-platforms-validate",
      label: "tofu validate platforms",
      image: images.base,
      commands: [
        ". ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter homelab --production",
        `export TF_PLUGIN_CACHE_DIR=${TOFU_PLUGIN_CACHE.path}`,
        `for stack in ${PLATFORM_STACKS.join(" ")}; do`,
        `  flock -x ${TOFU_PLUGIN_CACHE.path}/.lock bun --no-install packages/homelab/scripts/tofu/tofu-stack.ts "$stack" validate`,
        "done",
      ],
      timeoutMinutes: 30,
      resources: MEDIUM_TIER,
      events: ["pull_request"],
      changed: TOFU_CHANGED,
      secrets: [GITHUB_DOWNLOAD],
      volumes: [TOFU_PLUGIN_CACHE],
    },
    {
      key: "tofu-posthog-plan",
      label: "tofu validate posthog",
      image: images.base,
      commands: [
        ". ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter homelab --production",
        `export TF_PLUGIN_CACHE_DIR=${TOFU_PLUGIN_CACHE.path}`,
        `flock -x ${TOFU_PLUGIN_CACHE.path}/.lock bun --no-install packages/homelab/scripts/tofu/tofu-stack.ts posthog validate`,
      ],
      timeoutMinutes: 60,
      resources: MEDIUM_TIER,
      events: ["pull_request"],
      // The Buildkite lane re-derived a merge base and re-ran the changed-file
      // check inside the step. Selection now happens before generation, so the
      // guard is the step's changed-path list.
      changed: {
        include: [
          ...GLOBAL_SELECTOR_INPUTS,
          "packages/homelab/scripts/tofu/**",
          "packages/homelab/src/tofu/posthog/**",
        ],
      },
      secrets: [GITHUB_DOWNLOAD, ...STATE_BACKEND],
      volumes: [TOFU_PLUGIN_CACHE],
    },
  ];
}

export function tofuPlanSteps(images: CiImages): CiStep[] {
  const planned: CiStep[] = PLAN_STACKS.map((stack, index) => {
    const previous = PLAN_STACKS[index - 1];
    return {
      key: `tofu-plan-${stack}`,
      label: `tofu plan ${stack}`,
      image: images.base,
      commands: tofuCommands(stack, "plan"),
      timeoutMinutes: 30,
      resources: MEDIUM_TIER,
      events: ["pull_request"],
      changed: TOFU_CHANGED,
      secrets: [
        GITHUB_DOWNLOAD,
        ...STATE_BACKEND,
        ...(STACK_SECRETS[stack] ?? []),
      ],
      volumes: [TOFU_PLUGIN_CACHE],
      ...(previous === undefined
        ? {}
        : { dependsOn: [`tofu-plan-${previous}`] }),
    };
  });
  return [...planned, ...tofuValidateSteps(images)];
}
