import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { MatomoMariaDB } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/matomo-mariadb.ts";
import { createMatomoDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/analytics/matomo.ts";

export function createMatomoChart(app: App) {
  const chart = new Chart(app, "matomo", {
    namespace: "matomo",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "matomo-namespace", {
    metadata: { name: "matomo" },
  });

  const mariadb = new MatomoMariaDB(chart, "matomo-mariadb", {
    namespace: "matomo",
    storageClass: "zfs-ssd",
    storageSize: "32Gi",
  });

  createMatomoDeployment(chart, { mariadb });
}
