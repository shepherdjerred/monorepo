import type { EnforcementStage } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

/**
 * The NetworkPolicy enforcement stage of every namespace the charts render a
 * NetworkPolicy into.
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
  birmel: "open",
  bugsink: "open",
  buildkitd: "open",
  delivery: "open",
  "delivery-platform-jobs": "open",
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

/** The stage of a namespace that has policies; an unlisted one is an error. */
export function enforcementStageOf(namespace: string): EnforcementStage {
  const stage = ENFORCEMENT_STAGES[namespace];
  if (stage === undefined)
    throw new Error(
      `Namespace ${namespace} renders a NetworkPolicy but has no enforcement stage: add it to ENFORCEMENT_STAGES as "open"`,
    );
  return stage;
}
