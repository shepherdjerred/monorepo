import { App, Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createS3StaticSitesDeployment } from "../resources/s3-static-sites/index.ts";

export function createS3StaticSitesChart(app: App) {
  const chart = new Chart(app, "s3-static-sites", {
    namespace: "s3-static-sites",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "s3-static-sites-namespace", {
    metadata: {
      name: "s3-static-sites",
    },
  });

  createS3StaticSitesDeployment(chart);
}
