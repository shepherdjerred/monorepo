/**
 * The reviewed, non-derivable half of each catalog recipe (Delivery model,
 * sections 4.7 and 4.19): which Application constructor realises an
 * environment, which stages an operator attests, which recipes take the
 * `platform` shared lock, the oracles Git declares, and the acquired images an
 * upstream chart's values pin. Everything else in a recipe is serialised from
 * the constructors by `catalog-revisions.ts`.
 */
import type {
  Monitor,
  RecipeDefinition,
} from "@shepherdjerred/delivery/model-contract";

/**
 * `cluster-nodes` (Delivery model X13): one operator-run environment per node.
 * There is no node adapter; the operator upgrades the node by hand and
 * attests each stage, and the recipe wraps the host with the images the
 * upgrade moves: the node's Talos factory installer and the kubelet.
 */
export const NODE_RECIPES: Readonly<
  Record<string, Extract<RecipeDefinition, { kind: "operator-run" }>>
> = Object.fromEntries(
  ["liskov", "torvalds"].map((node) => [
    `cluster-nodes/${node}`,
    {
      kind: "operator-run",
      wrapped: {
        kind: "host",
        instance: `host:${node}`,
        components: [`image:installer-${node}`, "image:kubelet"],
      },
      stages: ["talos-upgrade", "kubernetes-upgrade"],
    },
  ]),
);

/**
 * Channel environments (Delivery model, section 5): a release to an audience
 * publishes the build's artifact to the store if absent, moves the pointer and
 * reads it back. webring/latest is the npm `latest` dist-tag of the webring
 * package; its tarball is the service's archive:webring-package component.
 */
export const CHANNEL_RECIPES: Readonly<
  Record<string, Extract<RecipeDefinition, { kind: "channel" }>>
> = {
  "webring/latest": {
    kind: "channel",
    store: "npm",
    name: "webring",
    pointer: "latest",
    forwardOnly: false,
    artifactComponent: "archive:webring-package",
  },
};

/**
 * Operator-run environments (section 5) and the stages the operator's
 * attestation covers. `cluster-admission` can deny admission to the whole
 * cluster, so its oracle is the T7 canary: a server-side dry-run pod and
 * volume claim plus an Application sync-options update.
 */
export const OPERATOR_RUN_STAGES: Readonly<Record<string, readonly string[]>> =
  {
    "cluster-admission/prod": ["apply-safety", "sync", "admission-canary"],
    "delivery-data/prod": ["apply-safety", "sync"],
    "temporal-data/prod": ["apply-safety", "sync"],
  };

/** Recipes that act on cluster root objects take the `platform` shared lock (T1). */
export const PLATFORM_LOCK_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "cluster-admission/prod",
  "cluster-platform/prod",
  "cluster-observability/prod",
]);

function scoutMonitor(
  environment: "beta" | "prod",
  matchesThreshold: number,
  policy: Monitor["policy"],
): Monitor {
  return {
    component: "image:scout-for-lol",
    alarms: {
      matchers: { alertname: "~Scout.*", environment },
      severities: ["warning", "critical"],
    },
    // Discord commands are too rare to settle on: beta saw none in seven
    // days and prod about seven a day, so a command threshold would hold
    // every promotion. Applied match receipts run at roughly 140 a day on
    // beta and 5,300 a day on prod.
    evidence: [
      {
        key: "matches-processed",
        query: `sum(increase(scout_durable_receipts_recorded_total{environment="${environment}",git_sha="$gitSha",outcome="applied"}[$window]))`,
        threshold: matchesThreshold,
      },
    ],
    policy,
  };
}

/**
 * Scout's monitors: beta settles before prod may promote (W3) and holds on an
 * alarm; prod rolls back automatically.
 */
export const ENVIRONMENT_MONITORS: Readonly<Record<string, Monitor>> = {
  "scout-for-lol/beta": scoutMonitor("beta", 5, "hold"),
  "scout-for-lol/prod": scoutMonitor("prod", 50, "automatic"),
};

/**
 * Test suites a qualification environment runs as deployment stages on the CI
 * node; each JSON report becomes `test` evidence (V5). None is declared: the
 * Minecraft sandbox qualifies on a Synced and Healthy sync of the candidate
 * image, and its heavy suites stay local runs the committer records.
 */
export const ENVIRONMENT_TESTS: Readonly<
  Record<string, readonly { suite: string; resultPath: string }[]>
> = {};

/**
 * Environments whose release restarts a server people play on. Each holds
 * its release at a leading players-offline step until nobody is connected,
 * so an automatic promotion never disconnects anyone.
 */
export const PLAYER_GATED_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "minecraft/tsmc",
]);

/**
 * Chart parameters whose Delivery image is not the component the parameter
 * names. The control-plane chart runs the Temporal worker image, and the
 * sandbox pod guard admits the candidate Storm image of the deployment's own
 * selection and the image accepted in `minecraft/tsmc`, which the minecraft
 * service's tracking reference component carries (A5, R7).
 */
export const IMAGE_PARAMETER_COMPONENTS: Readonly<Record<string, string>> = {
  "delivery.images.delivery-control-plane": "image:temporal-worker",
  "delivery.images.the-storm-server-candidate": "image:the-storm-server",
  "delivery.images.the-storm-server-accepted":
    "image:the-storm-server-accepted",
};

/**
 * Upstream-chart values that pin an acquired image. C2 keeps the pin out of
 * the configuration revision, so each becomes an artifact parameter bound to
 * an acquired image component. Keys are Helm parameter paths.
 */
export const ACQUIRED_IMAGE_PARAMETERS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  prometheus: {
    "grafana.imageRenderer.image.tag": "image:grafana-image-renderer",
  },
  "mc-router": { "image.tag": "image:mc-router" },
  "minecraft-tsmc": {
    "initContainers[0].image": "image:minecraft-server",
  },
  "minecraft-sjerred": {
    "image.tag": "image:minecraft-server-java8",
    "initContainers[0].image": "image:busybox",
    "initContainers[1].image": "image:minecraft-server-java8",
    "sidecarContainers[0].image": "image:haproxy",
  },
  "minecraft-shuxin": {
    "image.tag": "image:minecraft-server",
    "initContainers[0].image": "image:yq",
    "initContainers[1].image": "image:busybox",
  },
  velero: {
    "initContainers[0].image": "image:velero-plugin-for-aws",
    "kubectl.image.tag": "image:kubectl",
  },
};
