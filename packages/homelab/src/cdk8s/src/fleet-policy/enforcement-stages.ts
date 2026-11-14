import type { EnforcementStage } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

/**
 * The NetworkPolicy enforcement stage of every namespace that has pods and a
 * NetworkPolicy: those the charts here render one into, and those listed in
 * `STAGED_WITHOUT_RENDERED_POLICY`.
 *
 * `open`: the namespace's `enforcement-staging-<namespace>` policy allows all traffic for
 * every pod, so its other policies have no effect even where the cluster
 * enforces NetworkPolicy. `enforced`: the staging policy selects no pod and
 * the namespace's own policies decide.
 *
 * Cut a namespace over by changing its entry to `enforced`, and revert it by
 * changing it back; follow the wiki how-to
 * `how-to/cut-a-namespace-over-to-enforced-policies`. A namespace that gains
 * its first policy needs an entry here, and one that loses its last policy
 * must lose its entry: synthesis and the fleet tests fail otherwise.
 */
export const ENFORCEMENT_STAGES: Readonly<Record<string, EnforcementStage>> = {
  "alert-dashboard": "open",
  argocd: "open",
  birmel: "open",
  bugsink: "open",
  buildkitd: "open",
  delivery: "open",
  "delivery-platform-jobs": "open",
  "delivery-tsmc-controller": "open",
  "delivery-worker-jobs": "open",
  flipt: "open",
  freshrss: "open",
  "glitter-boys-launcher": "open",
  home: "open",
  media: "open",
  "minecraft-shuxin": "open",
  "minecraft-sjerred": "open",
  "minecraft-tsmc": "open",
  phoenix: "open",
  pinchtab: "open",
  postal: "open",
  prometheus: "open",
  redlib: "open",
  relay: "open",
  "scout-beta": "open",
  "scout-prod": "open",
  seaweedfs: "open",
  stash: "open",
  "storm-brain": "open",
  "storm-forum": "open",
  syncthing: "open",
  tasknotes: "open",
  temporal: "open",
  tracker: "open",
  "trmnl-dashboard": "open",
  woodpecker: "open",
  "woodpecker-ci": "open",
};

/**
 * Staged namespaces whose policies synthesis cannot see, and the charts that
 * carry each one's staging policy.
 *
 * - `upstream-chart`: the upstream Helm chart of `application` renders the
 *   policies. The Helm render test (`argocd-helm-render.test.ts`) fails when
 *   an upstream chart renders a NetworkPolicy into a namespace with no stage
 *   entry, and when an entry's Application no longer renders one. The staging
 *   policy is rendered where the Application's other first-party objects are:
 *   the root chart and the Application's companion chart, which mirrors it.
 * - `live-only`: the policy exists in the cluster and no source renders it.
 *   No test can derive these; the live coverage check is their only proof.
 */
export const STAGED_WITHOUT_RENDERED_POLICY: Readonly<
  Record<
    string,
    { charts: readonly string[]; reason: string } & (
      | { source: "upstream-chart"; application: string }
      | { source: "live-only" }
    )
  >
> = {
  argocd: {
    source: "upstream-chart",
    application: "argocd",
    charts: ["apps", "argocd-companion"],
    reason:
      "The argo-cd chart renders a NetworkPolicy per component (networkPolicy.create).",
  },
  prometheus: {
    source: "upstream-chart",
    application: "prometheus",
    charts: ["apps", "prometheus-companion"],
    reason:
      "The Grafana subchart of kube-prometheus-stack renders the image renderer's ingress policy.",
  },
  "delivery-tsmc-controller": {
    source: "live-only",
    charts: ["delivery-control-plane"],
    reason:
      "The Minecraft controller's chart resources were removed from source, but its StatefulSet and the delivery-control-plane chart's NetworkPolicy for it still run unpruned. Delete this entry once the namespace is retired.",
  },
};

/**
 * Namespaces that keep NetworkPolicies and are deliberately not staged:
 * enforcement applies to them from the moment the cluster enforces. Each
 * holds only an isolation policy left by a finished rehearsal or recovery and
 * runs no pod, so isolating it is the intent. A namespace matches by exact
 * `name` or by `prefix`.
 */
export const ENFORCED_WITHOUT_STAGING: readonly (
  { name: string; reason: string } | { prefix: string; reason: string }
)[] = [
  {
    name: "delivery-catalog-recovery",
    reason:
      "Isolation policy of a finished Delivery catalog recovery; no pods.",
  },
  {
    prefix: "ops-restore-",
    reason:
      "Isolation policies of restore rehearsals (ops-restore-rehearsal, -incremental, -temporal-<date>); restored data must stay unreachable and no pod runs between rehearsals.",
  },
  {
    prefix: "pg18-rehearsal-",
    reason:
      "Isolation policies of the PostgreSQL 18 upgrade rehearsals, one namespace per database; restored databases must stay unreachable and no pod runs.",
  },
];

/** Whether a namespace is deliberately enforced without a staging policy. */
export function enforcedWithoutStaging(namespace: string): boolean {
  return ENFORCED_WITHOUT_STAGING.some((entry) =>
    "name" in entry
      ? entry.name === namespace
      : namespace.startsWith(entry.prefix),
  );
}

/** The stage of a namespace that has policies; an unlisted one is an error. */
export function enforcementStageOf(namespace: string): EnforcementStage {
  const stage = ENFORCEMENT_STAGES[namespace];
  if (stage === undefined)
    throw new Error(
      `Namespace ${namespace} renders a NetworkPolicy but has no enforcement stage: add it to ENFORCEMENT_STAGES as "open"`,
    );
  return stage;
}
