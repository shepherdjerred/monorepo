import type { Chart } from "cdk8s";
import { ApiObject, JsonPatch, Size } from "cdk8s";
import {
  Capability,
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  type EnvValue,
  Pods,
  Service,
  type ServiceAccount,
  Volume,
} from "cdk8s-plus-31";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { temporalWorkerHealthProbes } from "./worker-health.ts";
import {
  NET_ADMIN_FIREWALL_RESOURCES,
  netAdminFirewallSecurityContext,
} from "@shepherdjerred/homelab/cdk8s/src/misc/net-admin-firewall.ts";

type CreateTemporalAgentWorkerProps = {
  serviceAccount: ServiceAccount;
  envVariables: Record<string, EnvValue>;
};

const AGENT_WORKER_UID = 1000;
const AGENT_PROVIDER_UID = 1001;

export const TEMPORAL_AGENT_POD_SECURITY_ENFORCEMENT = "privileged";

/**
 * Run provider-controlled report-only subprocesses outside domain workers.
 *
 * The service account receives the audit reader ClusterRole but none of the
 * namespace-scoped exec roles required by deterministic maintenance and
 * canary activities. The deployment receives provider auth only so its
 * parent-owned loopback broker can inject it upstream; provider subprocesses
 * receive only an ephemeral broker credential. Non-secret evidence endpoints
 * remain available, email delivery runs on the reports queue, and the public
 * repository checkout is unauthenticated. Provider subprocesses run as a
 * distinct uid. A NET_ADMIN init container
 * installs owner-matched firewall rules that reject Temporal gRPC and UI
 * traffic for that uid while the capability-minimal root poller keeps its
 * server connection and uses setpriv for the uid transition.
 * The provider cannot inherit SETUID across exec because privilege escalation
 * is disabled. These controls make the runtime enforce the report-only
 * boundary even if a provider disregards its prompt.
 */
export function createTemporalAgentWorker(
  chart: Chart,
  props: CreateTemporalAgentWorkerProps,
): Deployment {
  const deployment = new Deployment(chart, "temporal-agent-worker", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: { "argocd.argoproj.io/sync-wave": "3" },
    },
    serviceAccount: props.serviceAccount,
    automountServiceAccountToken: false,
    securityContext: {
      fsGroup: AGENT_WORKER_UID,
    },
    podMetadata: {
      annotations: {
        "ci.sjer.red/pod-security-enforcement":
          TEMPORAL_AGENT_POD_SECURITY_ENFORCEMENT,
      },
      labels: {
        app: "temporal-agent-worker",
        component: "agent-worker",
      },
    },
  });

  setRevisionHistoryLimit(deployment, 5);

  const firewallRunVolume = Volume.fromEmptyDir(
    chart,
    "temporal-agent-worker-firewall-run",
    "firewall-run",
  );
  deployment.addInitContainer(
    withCommonProps({
      name: "install-provider-firewall",
      image: `ghcr.io/shepherdjerred/temporal-worker:${versions["shepherdjerred/temporal-worker"]}`,
      command: ["/bin/sh", "-c"],
      args: [
        `set -eu
for firewall in iptables ip6tables; do
  for port in 7233 8080; do
    if "$firewall" -C OUTPUT -p tcp -m owner --uid-owner ${AGENT_PROVIDER_UID.toString()} --dport "$port" -j REJECT --reject-with tcp-reset; then
      echo "provider firewall already rejects tcp/$port via $firewall"
    else
      "$firewall" -A OUTPUT -p tcp -m owner --uid-owner ${AGENT_PROVIDER_UID.toString()} --dport "$port" -j REJECT --reject-with tcp-reset
    fi
  done
done
for host in temporal.tailnet-1a49.ts.net temporal-ui.tailnet-1a49.ts.net; do
  addresses="$(getent ahosts "$host" | awk '{print $1}' | sort -u)"
  if [ -z "$addresses" ]; then
    echo "unable to resolve $host for the provider firewall" >&2
    exit 1
  fi
  for address in $addresses; do
    case "$address" in
      *:*) firewall=ip6tables ;;
      *) firewall=iptables ;;
    esac
    if "$firewall" -C OUTPUT -p tcp -m owner --uid-owner ${AGENT_PROVIDER_UID.toString()} -d "$address" --dport 443 -j REJECT --reject-with tcp-reset; then
      echo "provider firewall already rejects $host at $address"
    else
      "$firewall" -A OUTPUT -p tcp -m owner --uid-owner ${AGENT_PROVIDER_UID.toString()} -d "$address" --dport 443 -j REJECT --reject-with tcp-reset
    fi
  done
done
iptables -L OUTPUT -n
ip6tables -L OUTPUT -n`,
      ],
      securityContext: netAdminFirewallSecurityContext(true),
      volumeMounts: [{ path: "/run", volume: firewallRunVolume }],
      resources: NET_ADMIN_FIREWALL_RESOURCES,
    }),
  );

  const container = deployment.addContainer(
    withCommonProps({
      name: "temporal-agent-worker",
      image: `ghcr.io/shepherdjerred/temporal-worker:${versions["shepherdjerred/temporal-worker"]}`,
      ports: [
        { number: 9464, name: "metrics" },
        { number: 9465, name: "app-metrics" },
      ],
      securityContext: {
        user: 0,
        group: AGENT_WORKER_UID,
        ensureNonRoot: false,
        privileged: false,
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: false,
        capabilities: {
          drop: [Capability.ALL],
          add: [Capability.CHOWN, Capability.DAC_OVERRIDE, Capability.SETUID],
        },
      },
      resources: {
        cpu: {
          request: Cpu.millis(500),
          limit: Cpu.millis(1500),
        },
        memory: {
          // The 30d working-set peak is ~505MiB, and that peak is a real bound
          // because the agent-task worker pins maxConcurrentActivityTaskExecutions
          // to 1 (packages/temporal/src/worker.ts), so overlapping scheduled
          // tasks queue instead of multiplying provider subprocesses. Keep a
          // rounded 768MiB request and 1GiB limit for task bursts without
          // reserving the 3GiB used by the larger infra and glitter workers.
          request: Size.mebibytes(768),
          limit: Size.gibibytes(1),
        },
      },
      ...temporalWorkerHealthProbes(),
      envVariables: props.envVariables,
    }),
  );

  const publicClusterCa = Volume.fromConfigMap(
    chart,
    "temporal-agent-worker-public-cluster-ca",
    ConfigMap.fromConfigMapName(
      chart,
      "temporal-agent-worker-cluster-ca-config-map",
      "kube-root-ca.crt",
    ),
    {
      items: { "ca.crt": { path: "ca.crt" } },
      defaultMode: 0o444,
    },
  );
  container.mount("/etc/kubernetes", publicClusterCa, { readOnly: true });

  // The root poller needs read-only Kubernetes evidence, but provider code runs
  // as uid/gid 1001 with supplementary groups cleared. Project the token at
  // owner-only mode instead of using Kubernetes' world-readable automount.
  const hiddenServiceAccountVolume = "provider-hidden-service-account";
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/template/spec/volumes/-", {
      name: hiddenServiceAccountVolume,
      projected: {
        defaultMode: 0o600,
        sources: [
          {
            serviceAccountToken: {
              path: "token",
              expirationSeconds: 3600,
            },
          },
          {
            configMap: {
              name: "kube-root-ca.crt",
              items: [{ key: "ca.crt", path: "ca.crt" }],
            },
          },
          {
            downwardAPI: {
              items: [
                {
                  path: "namespace",
                  fieldRef: {
                    apiVersion: "v1",
                    fieldPath: "metadata.namespace",
                  },
                },
              ],
            },
          },
        ],
      },
    }),
    JsonPatch.add("/spec/template/spec/containers/0/volumeMounts/-", {
      name: hiddenServiceAccountVolume,
      mountPath: "/var/run/secrets/kubernetes.io/serviceaccount",
      readOnly: true,
    }),
  );

  const tmpVolume = Volume.fromEmptyDir(
    chart,
    "temporal-agent-worker-tmp",
    "agent-tmp",
  );
  container.mount("/tmp", tmpVolume);

  const agentSelector = Pods.select(chart, "temporal-agent-worker-selector", {
    labels: { component: "agent-worker" },
  });
  new Service(chart, "temporal-agent-worker-metrics-service", {
    selector: agentSelector,
    metadata: {
      labels: { component: "agent-worker-metrics" },
    },
    ports: [{ port: 9464, name: "metrics" }],
  });

  createServiceMonitor(chart, {
    name: "temporal-agent-worker-metrics",
    matchLabels: { component: "agent-worker-metrics" },
  });

  new Service(chart, "temporal-agent-worker-app-metrics-service", {
    metadata: {
      name: "temporal-agent-worker-app-metrics",
      labels: { component: "agent-worker-app-metrics" },
    },
    selector: agentSelector,
    ports: [{ name: "app-metrics", port: 9465, targetPort: 9465 }],
  });

  createServiceMonitor(chart, {
    name: "temporal-agent-worker-app-metrics",
    port: "app-metrics",
    interval: "30s",
    matchLabels: { component: "agent-worker-app-metrics" },
  });

  return deployment;
}
