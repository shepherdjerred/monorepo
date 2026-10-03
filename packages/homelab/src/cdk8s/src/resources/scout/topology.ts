import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";

/** Hosted stages always run separate application, gateway and activity roles. */
export const SCOUT_STAGES = [
  "beta",
  "prod",
] as const satisfies readonly Stage[];
