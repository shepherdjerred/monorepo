/**
 * A deployment is a flag document a workload reads.
 *
 * Prod-only services have one row. A second row exists only when a second
 * workload reads a second document. Two workloads that read the same Flipt
 * namespace and environment share one row, because they share one document
 * today. Storm forum and storm brain both read `storm`/`prod`. The forum beta
 * chart publishes no release, so nothing reads `storm`/`beta`. `justin` has
 * inventory flags and no chart selector, so it is not here.
 *
 * The Temporal ingress gateway and Temporal workers both read `temporal/prod`
 * now that the beta Photon owner list is carried in the production override.
 */

export type FlagDeployment = {
  readonly id: string;
  readonly catalog: string;
  /** Stage label from the workload. Not a global bucket. */
  readonly stage: string;
  /** Flipt environment the workload reads until the consumer cut. */
  readonly fliptEnvironment: "beta" | "prod";
};

export const flagDeployments = [
  {
    id: "alert-dashboard/prod",
    catalog: "alert-dashboard",
    stage: "prod",
    fliptEnvironment: "prod",
  },
  {
    id: "arcade/prod",
    catalog: "arcade",
    stage: "prod",
    fliptEnvironment: "prod",
  },
  {
    id: "birmel/prod",
    catalog: "birmel",
    stage: "prod",
    fliptEnvironment: "prod",
  },
  {
    id: "delivery/prod",
    catalog: "delivery",
    stage: "prod",
    fliptEnvironment: "prod",
  },
  {
    id: "golink/prod",
    catalog: "golink",
    stage: "prod",
    fliptEnvironment: "prod",
  },
  {
    id: "media/prod",
    catalog: "media",
    stage: "prod",
    fliptEnvironment: "prod",
  },
  {
    id: "minecraft/tsmc",
    catalog: "the-storm",
    stage: "tsmc",
    fliptEnvironment: "prod",
  },
  {
    id: "scout/beta",
    catalog: "scout",
    stage: "beta",
    fliptEnvironment: "beta",
  },
  {
    id: "scout/prod",
    catalog: "scout",
    stage: "prod",
    fliptEnvironment: "prod",
  },
  {
    id: "starlight-karma-bot/beta",
    catalog: "starlight-karma-bot",
    stage: "beta",
    fliptEnvironment: "beta",
  },
  {
    id: "starlight-karma-bot/prod",
    catalog: "starlight-karma-bot",
    stage: "prod",
    fliptEnvironment: "prod",
  },
  {
    id: "storm/prod",
    catalog: "storm",
    stage: "prod",
    fliptEnvironment: "prod",
  },
  {
    id: "streambot/prod",
    catalog: "streambot",
    stage: "prod",
    fliptEnvironment: "prod",
  },
  {
    id: "temporal/prod",
    catalog: "temporal",
    stage: "prod",
    fliptEnvironment: "prod",
  },
  {
    id: "tracker/prod",
    catalog: "tracker",
    stage: "prod",
    fliptEnvironment: "prod",
  },
  {
    id: "trmnl-dashboard/prod",
    catalog: "trmnl-dashboard",
    stage: "prod",
    fliptEnvironment: "prod",
  },
  {
    id: "woodpecker/prod",
    catalog: "woodpecker",
    stage: "prod",
    fliptEnvironment: "prod",
  },
] as const satisfies readonly FlagDeployment[];

export function flagDeploymentForSelector(
  catalog: string,
  fliptEnvironment: string,
): FlagDeployment | undefined {
  return flagDeployments.find(
    (deployment) =>
      deployment.catalog === catalog &&
      deployment.fliptEnvironment === fliptEnvironment,
  );
}
