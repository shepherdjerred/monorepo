import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { PostgresqlSpecUsers } from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";
import { createFirstPartyGolinkDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/golink/index.ts";
import { createSingleAppPostgreSQL } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/single-app-postgresql.ts";

export function createGolinkChart(app: App, options?: { image?: string }) {
  const chart = new Chart(app, "golink", {
    namespace: "golink",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "golink-namespace", { metadata: { name: "golink" } });
  createSingleAppPostgreSQL(chart, {
    app: "golink",
    userFlags: [PostgresqlSpecUsers.CREATEDB],
  });
  createFirstPartyGolinkDeployment(
    chart,
    options?.image ?? "docker.io/shepherdjerred/golink:delivery-recipe",
  );
  return chart;
}
