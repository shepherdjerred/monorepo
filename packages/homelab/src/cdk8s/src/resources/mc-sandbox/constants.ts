import { publicationImageDigests } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { MC_SANDBOX_STORM_IMAGE_PARAMETERS } from "@shepherdjerred/homelab/cdk8s/src/resources/mc-sandbox/image-parameters.ts";

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
 * original candidate and accepted artifact digests frozen into the chart.
 * An empty accepted catalog never grants an invented production image.
 */
export function mcSandboxImageAllowlist(
  inputs: Readonly<Record<string, string>> = publicationImageDigests(),
): string[] {
  const itzg = `itzg/minecraft-server:${versions["itzg/minecraft-server"]}`;
  return [
    itzg,
    `docker.io/${itzg}`,
    ...["candidate", "accepted"].flatMap((kind) => {
      const digest = inputs[`shepherdjerred/the-storm-server/${kind}`];
      if (digest === undefined) return [];
      if (!/^sha256:[a-f0-9]{64}$/u.test(digest))
        throw new Error("Frozen Minecraft image digest is invalid");
      return [`docker.io/shepherdjerred/the-storm-server@${digest}`];
    }),
  ];
}

/**
 * Under transition rendering the Storm images come from the deployment rather
 * than the chart bytes: Delivery stamps the selected tsmc candidate and
 * accepted image references as Helm parameters on each mc-sandbox
 * deployment, so a new candidate never needs a new chart. Each is required;
 * a deployment that names neither renders nothing.
 */
export function mcSandboxDeploymentImageAllowlist(): string[] {
  const itzg = `itzg/minecraft-server:${versions["itzg/minecraft-server"]}`;
  return [
    itzg,
    `docker.io/${itzg}`,
    ...MC_SANDBOX_STORM_IMAGE_PARAMETERS.map(
      (name) =>
        `{{ required \`Delivery requires image:${name}\` (get (get (.Values.delivery | default dict) "images" | default dict) "${name}") }}`,
    ),
  ];
}
