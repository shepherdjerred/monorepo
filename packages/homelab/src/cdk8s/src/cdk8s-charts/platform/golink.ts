import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { PostgresqlSpecUsers } from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";
import { createFirstPartyGolinkDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/golink/index.ts";
import { singleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";

export function createGolinkChart(app: App, options?: { image?: string }) {
  const chart = new Chart(app, "golink", {
    namespace: "golink",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "golink-namespace", { metadata: { name: "golink" } });
  const database = singleAppDatabase(chart, {
    app: "golink",
    provision: true,
    userFlags: [PostgresqlSpecUsers.CREATEDB],
  });
  createFirstPartyGolinkDeployment(
    chart,
    options?.image ?? "docker.io/shepherdjerred/golink:delivery-recipe",
    database,
  );
  return chart;
}
