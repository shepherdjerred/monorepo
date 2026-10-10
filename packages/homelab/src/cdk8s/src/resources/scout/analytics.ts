import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";
import { siteAnalyticsConfiguration } from "@shepherdjerred/homelab/cdk8s/src/misc/analytics.ts";

export function scoutAnalyticsConfiguration(stage: Stage) {
  return siteAnalyticsConfiguration(`scout-${stage}`);
}
