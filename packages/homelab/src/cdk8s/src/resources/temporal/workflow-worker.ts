import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, type Deployment, EnvValue } from "cdk8s-plus-31";
import { createTemporalDomainWorker } from "./domain-worker.ts";

export function createTemporalWorkflowWorker(
  chart: Chart,
  props: { serverServiceName: string },
): Deployment {
  return createTemporalDomainWorker(chart, {
    name: "temporal-workflows",
    component: "central-workflows",
    cpuRequest: Cpu.millis(250),
    cpuLimit: Cpu.millis(1000),
    memoryRequest: Size.mebibytes(512),
    memoryLimit: Size.gibibytes(2),
    automountServiceAccountToken: false,
    envVariables: {
      TEMPORAL_ADDRESS: EnvValue.fromValue(`${props.serverServiceName}:7233`),
      TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("workflows"),
      ENVIRONMENT: EnvValue.fromValue("production"),
      TELEMETRY_ENABLED: EnvValue.fromValue("true"),
      OTLP_ENDPOINT: EnvValue.fromValue(
        "http://tempo.tempo.svc.cluster.local:4318",
      ),
      TELEMETRY_SERVICE_NAME: EnvValue.fromValue("temporal-central-workflows"),
    },
  });
}
