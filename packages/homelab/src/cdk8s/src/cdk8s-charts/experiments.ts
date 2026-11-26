import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { singleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
import { closeActivationGate } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/activation.ts";
import {
  EXPERIMENTS_ACTIVE,
  createExperimentsDeployment,
} from "@shepherdjerred/homelab/cdk8s/src/resources/experiments/index.ts";

/** Prepared service: the chart is published inactive until its gate opens. */
export function createExperimentsChart(app: App, active = EXPERIMENTS_ACTIVE) {
  const chart = new Chart(app, "experiments", {
    namespace: "experiments",
    disableResourceNameHashes: true,
  });
  if (!active) return closeActivationGate(chart);
  new Namespace(chart, "experiments-namespace", {
    metadata: { name: "experiments" },
  });
  const database = singleAppDatabase(chart, {
    app: "experiments",
    provision: true,
    userFlags: [],
  });
  database.createClusterIngressPolicy("experiments-postgres-clients", {
    app: "experiments",
  });
  createExperimentsDeployment(chart, database);
  return chart;
}
