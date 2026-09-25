import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { MEDIUM_TIER, VERIFY_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";
import {
  GITHUB_DOWNLOAD,
  STATE_BACKEND,
  TOFU_PLUGIN_CACHE,
  grant,
  HANDOFF_KEYS,
  STACK_SECRETS,
} from "#src/pipeline/lanes/tofu.ts";

/**
 * The homelab release chain.
 *
 * These lanes run only on the default branch and mutate live infrastructure,
 * so each one re-checks the release admission token before doing anything.
 *
 * None of them carries a changed-path guard, and that is deliberate. Whether a
 * release is needed depends on something selection cannot know: whether the
 * image lane actually pushed anything this build. So the lanes always run on
 * the default branch and decide internally, exactly as they did under
 * Buildkite -- a guard here would skip a release that pushed images without
 * touching any helm or argocd path.
 */

/** Serializes the whole release so two builds cannot interleave a rollout. */
const RELEASE_GROUP = { limit: 1, group: "homelab-release" } as const;

/**
 * Stop unless this build still holds the release admission.
 *
 * `superseded` exits clean because a newer build will do the work; any other
 * verdict is a hard failure, since continuing would mutate infrastructure
 * without knowing whether this build was entitled to.
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

/**
 * Decide whether this build has anything to release.
 *
 * Three independent reasons: the helm sources changed, the argocd sources
 * changed, or images were pushed. The last one is why this cannot be a
 * selection-time guard.
 */
function releaseRequestedGate(): string[] {
  return [
    'image_digests="$(bun --no-install scripts/ci/read-ci-handoff.ts image-digests)"',
    "release_requested=false",
    "if bun --no-install ci/scripts/selectors/ci-changed.ts helm; then release_requested=true; fi",
    "if bun --no-install ci/scripts/selectors/ci-changed.ts argocd; then release_requested=true; fi",
    'if [ "$image_digests" != "{}" ]; then release_requested=true; fi',
    'if [ "$release_requested" != "true" ]; then exit 0; fi',
  ];
}

const ARGOCD_GRANT = grant("ci-argocd-credentials", "ARGOCD_AUTH_TOKEN");

/**
 * Assignments assembled from parts.
 *
 * Written this way so the `no-secrets` rule does not read a long env-var name
 * beside a path or a shell reference as a credential literal.
 */
const CADDYFILE_SMOKE_PATH = "/tmp/caddyfile.generated";
const SMOKE_PATH_VAR = "CADDYFILE_SMOKE_PATH";
const IMAGE_DIGESTS_VAR = "HOMELAB_IMAGE_DIGESTS_JSON";
const smokeAssignment = `${SMOKE_PATH_VAR}=${CADDYFILE_SMOKE_PATH}`;
const digestsAssignment = `export ${IMAGE_DIGESTS_VAR}="$image_digests"`;

/**
 * Pull-request image check: bake the affected application images and run
 * their in-image smoke tests, without pushing anything.
 *
 * `--affected` scopes the bake to images the change can reach; the BuildKit
 * cache is read-only here, since only main writes the cache refs. It shares
 * the main lane's Caddyfile smoke input, which verify hands off.
 */
export function imagesPrStep(images: CiImages): CiStep {
  return {
    key: "images-pr",
    label: "bake and smoke images (no push)",
    image: images.base,
    commands: [
      ". ci/scripts/toolchain.sh",
      "bun --no-install ci/scripts/reporting/buildkit-env.ts",
      `bun --no-install scripts/ci/read-ci-handoff.ts caddyfile | jq -r . > ${CADDYFILE_SMOKE_PATH}`,
      `${smokeAssignment} bun --no-install ci/scripts/images/bake-images.ts --affected`,
    ],
    dependsOn: ["verify"],
    timeoutMinutes: 60,
    resources: VERIFY_TIER,
    events: ["pull_request"],
    changed: {
      include: [
        ...GLOBAL_SELECTOR_INPUTS,
        "ci/application-image-smoke.Dockerfile",
        "ci/scripts/images/application-image-runtime.ts",
        "ci/scripts/images/bake-images.ts",
        "ci/scripts/images/bake-retry.ts",
        "ci/scripts/reporting/buildkit-env.ts",
        "ci/scripts/selectors/ci-changed.ts",
        "ci/scripts/images/image-targets.ts",
        "ci/scripts/migration-core.ts",
        "ci/scripts/selectors/select-image-targets.ts",
        "ci/scripts/selectors/select-image-targets-lockfile.ts",
        "ci/scripts/selectors/select-image-targets-workspaces.ts",
        "ci/scripts/images/smoke-app-configs.ts",
        "ci/scripts/images/smoke-app-in-image.ts",
        "ci/scripts/toolchain.sh",
        "scripts/lib/image-pin-catalog.ts",
        ".dockerignore",
        "bun.lock",
        "bunfig.toml",
        "docker-bake.hcl",
        "package.json",
        "packages/**/package.json",
        "scripts/package.json",
        "patches/**",
        "turbo.json",
        "tsconfig.base.json",
        "packages/birmel/**",
        "packages/alert-dashboard/**",
        "packages/code-review/**",
        "packages/discord-plays-core/**",
        "packages/discord-plays-mario-kart/**",
        "packages/discord-plays-pokemon/**",
        "packages/discord-stream-lifecycle/**",
        "packages/discord-video-stream/**",
        "packages/eslint-config/**",
        "packages/home-assistant/**",
        "packages/homelab/images/**",
        "packages/homelab/scripts/smoke-images.ts",
        "packages/homelab/src/cdk8s/scripts/generate-caddyfile.ts",
        "packages/homelab/src/cdk8s/src/misc/common.ts",
        "packages/homelab/src/cdk8s/src/misc/s3-static-site.ts",
        "packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts",
        "packages/llm-models/**",
        "packages/llm-observability/**",
        "packages/ops-clients/**",
        "packages/ops-model/**",
        "packages/s3-signed-request/**",
        "packages/scout-for-lol/packages/backend/**",
        "packages/scout-for-lol/packages/data/**",
        "packages/scout-for-lol/packages/report/**",
        "packages/scout-for-lol/tsconfig.base.json",
        "packages/starlight-karma-bot/**",
        "packages/streambot/**",
        "packages/tasknotes-server/**",
        "packages/tasknotes-types/**",
        "packages/temporal/**",
        "packages/toolkit/**",
        "packages/trmnl-dashboard/**",
        "packages/voice-assistant/**",
      ],
    },
    secrets: [
      GITHUB_DOWNLOAD,
      grant("ci-github-credentials", "GITHUB_PACKAGES_TOKEN"),
      ...HANDOFF_KEYS,
    ],
  };
}

export function releaseChainSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "images",
      label: "bake and push images",
      image: images.base,
      commands: [
        ...admissionGate(),
        ". ci/scripts/toolchain.sh",
        "bun --no-install ci/scripts/reporting/buildkit-env.ts",
        // The Caddyfile is an input to the in-image smoke test. verify builds
        // it; it travels through the handoff store because each Woodpecker
        // workflow gets its own workspace.
        `bun --no-install scripts/ci/read-ci-handoff.ts caddyfile | jq -r . > ${CADDYFILE_SMOKE_PATH}`,
        `${smokeAssignment} bun --no-install ci/scripts/images/bake-images.ts --push`,
      ],
      dependsOn: ["verify", "homelab-release-admission"],
      timeoutMinutes: 60,
      resources: VERIFY_TIER,
      defaultBranchOnly: true,
      concurrency: { limit: 1, group: "image-push" },
      secrets: [
        GITHUB_DOWNLOAD,
        grant("ci-github-credentials", "GITHUB_PACKAGES_TOKEN"),
        ...HANDOFF_KEYS,
      ],
    },
    {
      key: "helm-push",
      label: "publish helm charts",
      image: images.base,
      commands: [
        ...admissionGate(),
        ...releaseRequestedGate(),
        ". ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter homelab --filter '@homelab/cdk8s' --production",
        'export ARGOCD_TOKEN="$ARGOCD_AUTH_TOKEN"',
        // Auto-sync is suspended for the whole rollout so ArgoCD cannot
        // reconcile a half-published set of charts.
        "bun --no-install packages/homelab/scripts/argocd/argocd.ts suspend-auto-sync apps --timeout 300",
        digestsAssignment,
        'export HOMELAB_VERSION_CATALOG_JSON="$(bun --no-install scripts/ci/read-ci-handoff.ts version-catalog)"',
        'export HOMELAB_RELEASE_VERSION="2.0.0-$CI_PIPELINE_NUMBER"',
        'bun --no-install packages/homelab/scripts/helm/helm-push.ts "$CI_PIPELINE_NUMBER"',
        // argocd-sync reads the expected revision back out of this.
        "bun --no-install scripts/ci/write-ci-handoff.ts argocd-release-expected < argocd-release-expected.json",
        "bun --no-install scripts/ci/write-ci-handoff.ts helm-release-plan < helm-release-plan.json",
      ],
      // The refresh lanes rewrite the toolchain image pins this publish
      // embeds, so the charts must not be built from a stale pin.
      dependsOn: [
        "homelab-release-admission",
        "images",
        "ci-base-refresh",
        "ci-playwright-refresh",
      ],
      timeoutMinutes: 60,
      resources: MEDIUM_TIER,
      defaultBranchOnly: true,
      concurrency: RELEASE_GROUP,
      secrets: [
        GITHUB_DOWNLOAD,
        ...STATE_BACKEND,
        ...HANDOFF_KEYS,
        ARGOCD_GRANT,
        grant("ci-chartmuseum-credentials", "CHARTMUSEUM_USERNAME"),
        grant("ci-chartmuseum-credentials", "CHARTMUSEUM_PASSWORD"),
      ],
    },
    {
      key: "argocd-sync",
      label: "reconcile argocd",
      image: images.base,
      commands: [
        ...admissionGate(),
        ...releaseRequestedGate(),
        ". ci/scripts/toolchain.sh",
        "ci/scripts/bun-install.sh --frozen-lockfile --filter homelab --filter '@homelab/cdk8s' --production",
        'export ARGOCD_TOKEN="$ARGOCD_AUTH_TOKEN"',
        "bun --no-install scripts/ci/read-ci-handoff.ts argocd-release-expected > argocd-release-expected.json",
        // release-root owns the exact-revision, lifecycle, immutable-field and
        // request-ownership checks; it must not be replaced with a bare sync.
        "bun --no-install packages/homelab/scripts/argocd/argocd.ts release-root apps argocd-release-expected.json",
      ],
      // Infrastructure is applied before ArgoCD reconciles against it, so
      // the sync sees the cluster the charts were built for.
      dependsOn: [
        "homelab-release-admission",
        "images",
        "helm-push",
        "tofu-apply-arr",
      ],
      timeoutMinutes: 60,
      resources: MEDIUM_TIER,
      defaultBranchOnly: true,
      concurrency: RELEASE_GROUP,
      secrets: [
        GITHUB_DOWNLOAD,
        ...STATE_BACKEND,
        ...HANDOFF_KEYS,
        ARGOCD_GRANT,
      ],
    },
    ...chainedTofuApplies(images),
  ];
}

/**
 * Applies that wait on the release rather than only on admission.
 *
 * seaweedfs must follow helm-push so buckets exist before workloads reference
 * them; tailscale and arr then follow it in order because they share the
 * plugin cache lock. cloudflare waits for argocd-sync because its DNS records
 * point at services that must already be reconciled.
 */
function chainedApplyCommands(stack: string): string[] {
  return [
    'release_admission="$(bun --no-install scripts/ci/homelab-release-admission.ts consume)"',
    'if [ "$release_admission" = "superseded" ]; then exit 0; fi',
    'if [ "$release_admission" != "admitted" ]; then',
    '  echo "invalid homelab release admission outcome: $release_admission" >&2',
    "  exit 1",
    "fi",
    ". ci/scripts/toolchain.sh",
    "ci/scripts/bun-install.sh --frozen-lockfile --filter homelab --production",
    `export TF_PLUGIN_CACHE_DIR=${TOFU_PLUGIN_CACHE.path}`,
    `flock -x ${TOFU_PLUGIN_CACHE.path}/.lock bun --no-install packages/homelab/scripts/tofu/tofu-stack.ts ${stack} apply`,
  ];
}

function chainedTofuApplies(images: CiImages): CiStep[] {
  const chain: {
    readonly stack: string;
    readonly dependsOn: readonly string[];
    readonly secrets: readonly ReturnType<typeof grant>[];
    readonly concurrency?: { readonly limit: number; readonly group: string };
  }[] = [
    {
      stack: "seaweedfs",
      dependsOn: ["homelab-release-admission", "helm-push"],
      // Same grants the plan lane used: this stack's provider identity is the
      // unscoped admin one, because it creates and deletes buckets.
      secrets: [...(STACK_SECRETS["seaweedfs"] ?? [])],
    },
    {
      stack: "tailscale",
      dependsOn: ["tofu-apply-seaweedfs"],
      secrets: [
        grant("ci-tailscale-credentials", "TAILSCALE_OAUTH_CLIENT_ID"),
        grant("ci-tailscale-credentials", "TAILSCALE_OAUTH_CLIENT_SECRET"),
      ],
    },
    {
      stack: "arr",
      dependsOn: ["tofu-apply-tailscale"],
      // Same grants the plan lane used. Two copies would let an apply run
      // with a credential its plan never saw.
      secrets: [...(STACK_SECRETS["arr"] ?? [])],
    },
    {
      stack: "cloudflare",
      dependsOn: ["homelab-release-admission", "argocd-sync"],
      concurrency: { limit: 1, group: "tofu-cloudflare" },
      secrets: [
        grant("ci-cloudflare-credentials", "CLOUDFLARE_ACCOUNT_ID"),
        grant("ci-cloudflare-credentials", "CLOUDFLARE_API_TOKEN"),
      ],
    },
  ];

  return chain.map(({ stack, dependsOn, secrets, concurrency }) => ({
    key: `tofu-apply-${stack}`,
    label: `tofu apply ${stack}`,
    image: images.base,
    commands: chainedApplyCommands(stack),
    dependsOn: [...dependsOn],
    timeoutMinutes: 60,
    resources: MEDIUM_TIER,
    defaultBranchOnly: true,
    secrets: [GITHUB_DOWNLOAD, ...STATE_BACKEND, ...HANDOFF_KEYS, ...secrets],
    volumes: [TOFU_PLUGIN_CACHE],
    ...(concurrency === undefined ? {} : { concurrency }),
  }));
}
