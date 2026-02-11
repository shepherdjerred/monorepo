import { App, Chart } from "cdk8s";
import { createGrafanaPostgreSQLDatabase } from "../resources/postgres/grafana-db.ts";

export function createGrafanaDbChart(app: App) {
  // grafana-db deploys to prometheus namespace (where Grafana lives)
  // This is because Grafana is deployed via kube-prometheus-stack (third-party)
  // and we can't add our PostgreSQL CRD to that chart
  const chart = new Chart(app, "grafana-db", {
    namespace: "prometheus",
    disableResourceNameHashes: true,
  });

  createGrafanaPostgreSQLDatabase(chart);
}
