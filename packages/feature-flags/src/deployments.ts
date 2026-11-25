/**
 * A deployment is a flag document a workload reads.
 *
 * Prod-only services have one row. A second row exists only when a second
 * workload reads a second document. Two workloads that read the same catalog
 * and stage share one row, because they share one document. Storm forum and
 * storm brain both read `storm`/`prod`. The forum beta chart publishes no
 * release, so nothing reads `storm`/`beta`. `justin` has inventory flags and no
 * chart selector, so it is not here.
 *
 * The Temporal ingress gateway and Temporal workers both read `temporal/prod`
 * now that the beta Photon owner list is carried in the production override.
 */

export type FlagDeployment = {
  readonly id: string;
  readonly catalog: string;
  /** Inventory stage projected into this deployment document. */
  readonly stage: "beta" | "prod";
};

export const flagDeployments = [
  {
    id: "alert-dashboard/prod",
    catalog: "alert-dashboard",
    stage: "prod",
  },
  {
    id: "arcade/prod",
    catalog: "arcade",
    stage: "prod",
  },
  {
    id: "birmel/prod",
    catalog: "birmel",
    stage: "prod",
  },
  {
    id: "delivery/prod",
    catalog: "delivery",
    stage: "prod",
  },
  {
    id: "errors/prod",
    catalog: "errors",
    stage: "prod",
  },
  {
    id: "feeds/prod",
    catalog: "feeds",
    stage: "prod",
  },
  {
    id: "golink/prod",
    catalog: "golink",
    stage: "prod",
  },
  {
    id: "mail/prod",
    catalog: "mail",
    stage: "prod",
  },
  {
    id: "media/prod",
    catalog: "media",
    stage: "prod",
  },
  {
    id: "minecraft/tsmc",
    catalog: "the-storm",
    stage: "prod",
  },
  {
    id: "scout/beta",
    catalog: "scout",
    stage: "beta",
  },
  {
    id: "scout/prod",
    catalog: "scout",
    stage: "prod",
  },
  {
    id: "starlight-karma-bot/beta",
    catalog: "starlight-karma-bot",
    stage: "beta",
  },
  {
    id: "starlight-karma-bot/prod",
    catalog: "starlight-karma-bot",
    stage: "prod",
  },
  {
    id: "storm/prod",
    catalog: "storm",
    stage: "prod",
  },
  {
    id: "streambot/prod",
    catalog: "streambot",
    stage: "prod",
  },
  {
    id: "temporal/prod",
    catalog: "temporal",
    stage: "prod",
  },
  {
    id: "tracker/prod",
    catalog: "tracker",
    stage: "prod",
  },
  {
    id: "trmnl-dashboard/prod",
    catalog: "trmnl-dashboard",
    stage: "prod",
  },
  {
    id: "woodpecker/prod",
    catalog: "woodpecker",
    stage: "prod",
  },
] as const satisfies readonly FlagDeployment[];

export function flagDeploymentForSelector(
  catalog: string,
  stage: string,
): FlagDeployment | undefined {
  return flagDeployments.find(
    (deployment) =>
      deployment.catalog === catalog && deployment.stage === stage,
  );
}
