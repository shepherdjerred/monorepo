import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Probe,
  Protocol,
  Service,
  Volume,
} from "cdk8s-plus-31";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";

export function createScoutWorkflowWorker(
  chart: Chart,
  stage: Stage,
): Deployment {
  const track = "candidate";
  const component = `scout-${stage}-workflows-${track}`;
  const name = `scout-workflow-worker-${track}`;
  const deployment = new Deployment(chart, name, {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    automountServiceAccountToken: false,
    securityContext: { fsGroup: 1000 },
    metadata: {
      annotations: {
        // This recipe is expanded only from the frozen PostgreSQL pool.
        "argocd.argoproj.io/sync-wave": "-2",
      },
    },
    podMetadata: {
      labels: {
        app: "scout-workflow-worker",
        component,
        "worker-family": `scout-${stage}-workflows`,
        track,
      },
    },
  });
  setRevisionHistoryLimit(deployment, 5);

  const container = deployment.addContainer(
    withCommonProps({
      name,
      image:
        '{{ required `Delivery requires image:scout-for-lol` (get (get (.Values.delivery | default dict) "images" | default dict) "scout-for-lol") }}',
      command: ["bun"],
      args: ["run", "src/temporal/workflow-worker.ts"],
      ports: [{ name: "metrics", number: 9464, protocol: Protocol.TCP }],
      readiness: Probe.fromCommand(
        [
          "bun",
          "-e",
          String.raw`const response=await fetch('http://127.0.0.1:9464/metrics',{signal:AbortSignal.timeout(2000)});const ready=response.ok&&(await response.text()).split('\n').some(line=>line.startsWith('temporal_worker_num_pollers{')&&line.includes('poller_type="workflow_task"')&&Number(line.slice(line.lastIndexOf(' ')+1))>0);process.exit(ready?0:1)`,
        ],
        {
          periodSeconds: Duration.seconds(5),
          timeoutSeconds: Duration.seconds(3),
          failureThreshold: 3,
        },
      ),
      securityContext: {
        user: 1000,
        group: 1000,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
      },
      resources: {
        cpu: { request: Cpu.millis(100), limit: Cpu.millis(500) },
        memory: { request: Size.mebibytes(256), limit: Size.gibibytes(1) },
      },
      envVariables: {
        ENVIRONMENT: EnvValue.fromValue(stage),
        TEMPORAL_ADDRESS: EnvValue.fromValue(
          "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
        ),
        TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
        // Workflow workers are isolated to the stage they serve.
        TEMPORAL_NAMESPACE: EnvValue.fromValue(stage),
        TEMPORAL_WORKER_DEPLOYMENT_NAME: EnvValue.fromValue(
          `scout-${stage}-workflows`,
        ),
      },
    }),
  );
  container.mount(
    "/tmp",
    Volume.fromEmptyDir(chart, `${name}-tmp`, `${component}-tmp`),
  );

  new Service(chart, `${name}-metrics-service`, {
    metadata: {
      labels: { component },
    },
    selector: deployment,
    ports: [{ name: "metrics", port: 9464 }],
  });
  createServiceMonitor(chart, {
    name: `${name}-metrics`,
    matchLabels: { component },
  });

  return deployment;
}
