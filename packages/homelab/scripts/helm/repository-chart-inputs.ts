import path from "node:path";
import { dormantCharts } from "#cdk8s/src/resources/companions/dormant.ts";
import { type ChartInput, discoverChartInputs } from "./helm-release-core.ts";

/**
 * Every repository chart synthesis renders now. Companion shells stay
 * dormant until transition rendering synthesizes their manifests.
 */
export function repositoryChartInputs(homelab: string): Promise<ChartInput[]> {
  return discoverChartInputs(
    path.join(homelab, "src/cdk8s/helm"),
    path.join(homelab, "src/cdk8s/dist"),
    dormantCharts(),
  );
}
