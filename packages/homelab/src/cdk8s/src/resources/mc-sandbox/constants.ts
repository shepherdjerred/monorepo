import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

/**
 * Names shared by the mc-sandbox chart and the mc-harness Kubernetes
 * provider (packages/mc-harness), which creates pods here by impersonating
 * {@link MC_HARNESS_SERVICE_ACCOUNT}. Changing one side means changing both.
 */
export const MC_SANDBOX_NAMESPACE = "mc-sandbox";
export const MC_HARNESS_SERVICE_ACCOUNT = "mc-harness";
export const MC_HARNESS_MANAGED_BY = "mc-harness";
export const MC_HARNESS_EXPIRES_AT_ANNOTATION =
  "mc-harness.sjer.red/expires-at";

/** Hard ceiling on a sandbox's lifetime; the daemon reaps sooner. */
export const MC_SANDBOX_MAX_DEADLINE_SECONDS = 8 * 60 * 60;

/** The live server the harness may read, port-forward to, and back up. */
export const MC_LIVE_NAMESPACE = "minecraft-tsmc";
export const MC_LIVE_STATEFULSET = "minecraft-tsmc";
export const MC_LIVE_POD = "minecraft-tsmc-0";

/**
 * The only images a sandbox pod may run: the itzg catalog pin the harness
 * uses for its `paper` and `storm-dev` profiles, and the Storm server image at
 * its candidate and production pins. The harness writes images in the
 * `<repo>:<tag>@sha256:<digest>` form these pins already have.
 */
export function mcSandboxImageAllowlist(): string[] {
  const itzg = `itzg/minecraft-server:${versions["itzg/minecraft-server"]}`;
  return [
    itzg,
    `docker.io/${itzg}`,
    `ghcr.io/shepherdjerred/the-storm-server:${versions["shepherdjerred/the-storm-server"]}`,
    `ghcr.io/shepherdjerred/the-storm-server:${versions["shepherdjerred/the-storm-server/prod"]}`,
  ];
}
