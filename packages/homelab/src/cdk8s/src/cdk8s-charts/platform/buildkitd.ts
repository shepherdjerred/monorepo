import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createBuildkitdDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/buildkitd.ts";

export function createBuildkitdChart(app: App) {
  const chart = new Chart(app, "buildkitd", {
    namespace: "buildkitd",
    disableResourceNameHashes: true,
  });

  // Run the patched daemon (packages/homelab/images/buildkitd) until upstream
  // BuildKit reuses timestamp-rewritten layers itself; its README says how to
  // switch back to `upstream` and drop the patch.
  createBuildkitdDeployment(chart, { image: "rewrite-reuse" });
}
