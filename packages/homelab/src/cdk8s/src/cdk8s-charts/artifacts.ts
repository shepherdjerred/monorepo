import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { PostgresqlSpecUsers } from "@shepherdjerred/homelab/cdk8s/generated/imports/acid.zalan.do";
import { closeActivationGate } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/activation.ts";
import { singleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import {
  ARTIFACTS_ACTIVE,
  createArtifactsDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/artifacts/index.ts";

export function createArtifactsChart(app: App, active = ARTIFACTS_ACTIVE) {
  const chart = new Chart(app, "artifacts", {
    namespace: "artifacts",
    disableResourceNameHashes: true,
  });
  if (!active) return closeActivationGate(chart);
  new Namespace(chart, "artifacts-namespace", {
    metadata: { name: "artifacts" },
  });
  const database = singleAppDatabase(chart, {
    app: "artifacts",
    provision: true,
    userFlags: [PostgresqlSpecUsers.CREATEDB],
  });
  database.createClusterIngressPolicy(
    "artifacts-pg-netpol",
    { app: "artifacts" },
    { name: "artifacts-pg-netpol" },
  );
  createArtifactsDeployment(chart, database);
  return chart;
}
