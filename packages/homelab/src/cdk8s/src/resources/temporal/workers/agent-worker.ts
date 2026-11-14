import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { tailnetService } from "homelab/src/platform-model.ts";
import type { Chart } from "cdk8s";
import { ApiObject, Duration, JsonPatch, Size } from "cdk8s";
import {
  Capability,
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  type EnvValue,
  type k8s,
  Pods,
  Service,
  SeccompProfileType,
  type ServiceAccount,
  Volume,
} from "cdk8s-plus-31";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import { temporalWorkerHealthProbes } from "./worker-health.ts";
import {
  NET_ADMIN_FIREWALL_RESOURCES,
  netAdminFirewallSecurityContext,
} from "@shepherdjerred/homelab/cdk8s/src/misc/net-admin-firewall.ts";

type CreateTemporalAgentWorkerProps = {
  serviceAccount: ServiceAccount;
  envVariables: Record<string, EnvValue>;
  name?: string;
  component?: string;
  sandboxSeccompProfile?: string;
  initializeStickyTmpDirectory?: boolean;
  terminationGraceSeconds?: number;
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
 * server connection and uses setpriv for the uid/gid transition.
 * The provider cannot inherit SETUID or SETGID across exec because privilege
 * escalation is disabled. These controls make the runtime enforce the report-only
 * boundary even if a provider disregards its prompt.
 */
export function createTemporalAgentWorker(
  chart: Chart,
  props: CreateTemporalAgentWorkerProps,
): Deployment {
  const name = props.name ?? "temporal-agent-worker";
  const component = props.component ?? "agent-worker";
  const deployment = new Deployment(chart, name, {
    replicas: 1,
    ...(props.terminationGraceSeconds === undefined
      ? {}
      : {
          terminationGracePeriod: Duration.seconds(
            props.terminationGraceSeconds,
          ),
        }),
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: { "argocd.argoproj.io/sync-wave": "3" },
    },
    serviceAccount: props.serviceAccount,
    automountServiceAccountToken: false,
    podMetadata: {
      annotations: {
        "ci.sjer.red/pod-security-enforcement":
          TEMPORAL_AGENT_POD_SECURITY_ENFORCEMENT,
      },
      labels: {
        app: name,
        component,
      },
    },
  });

  setRevisionHistoryLimit(deployment, 5);

  const firewallRunVolume = Volume.fromEmptyDir(
    chart,
    `${name}-firewall-run`,
    "firewall-run",
  );
  const tmpVolume = Volume.fromEmptyDir(chart, `${name}-tmp`, "agent-tmp");
  const stickyTmpBootstrap =
    props.initializeStickyTmpDirectory === true
      ? `if [ ! -d /tmp ] || [ -L /tmp ] || [ "$(stat -c '%u' /tmp)" != 0 ]; then
  echo "provider temporary directory must be a root-owned directory" >&2
  exit 1
fi
chmod 1777 /tmp
if [ ! -d /tmp ] || [ -L /tmp ] || [ "$(stat -c '%u:%a' /tmp)" != 0:1777 ]; then
  echo "provider temporary directory sticky permissions failed verification" >&2
  exit 1
fi
`
      : "";
  deployment.addInitContainer(
    withCommonProps({
      name: "install-provider-firewall",
      image: firstPartyImageRecipe("temporal-worker"),
      command: ["/bin/sh", "-c"],
      args: [
        `set -eu
${stickyTmpBootstrap}for firewall in iptables ip6tables; do
  for port in 7233 8080; do
    if "$firewall" -C OUTPUT -p tcp -m owner --uid-owner ${AGENT_PROVIDER_UID.toString()} --dport "$port" -j REJECT --reject-with tcp-reset; then
      echo "provider firewall already rejects tcp/$port via $firewall"
    else
      "$firewall" -A OUTPUT -p tcp -m owner --uid-owner ${AGENT_PROVIDER_UID.toString()} --dport "$port" -j REJECT --reject-with tcp-reset
    fi
  done
done
for host in ${tailnetService("temporal").fqdn} ${tailnetService("temporal-ui").fqdn}; do
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
      volumeMounts: [
        { path: "/run", volume: firewallRunVolume },
        ...(props.initializeStickyTmpDirectory === true
          ? [{ path: "/tmp", volume: tmpVolume }]
          : []),
      ],
      resources: NET_ADMIN_FIREWALL_RESOURCES,
    }),
  );

  const container = deployment.addContainer(
    withCommonProps({
      name,
      image: firstPartyImageRecipe("temporal-worker"),
      ports: [
        { number: 9464, name: "metrics" },
        { number: 9465, name: "app-metrics" },
      ],
      securityContext: {
        ...(props.sandboxSeccompProfile === undefined
          ? {}
          : {
              seccompProfile: {
                type: SeccompProfileType.LOCALHOST,
                localhostProfile: props.sandboxSeccompProfile,
              },
            }),
        user: 0,
        group: AGENT_WORKER_UID,
        ensureNonRoot: false,
        privileged: false,
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: false,
        capabilities: {
          drop: [Capability.ALL],
          add: [
            Capability.CHOWN,
            Capability.DAC_OVERRIDE,
            Capability.KILL,
            Capability.SETGID,
            Capability.SETUID,
          ],
        },
      },
      resources: {
        // 30d CPU p99 0.03 cores, peak 0.04 (5m rate); the limit covers
        // provider subprocess bursts.
        cpu: {
          request: Cpu.millis(250),
          limit: Cpu.millis(1500),
        },
        memory: {
          // The 30d working-set peak is ~505MiB, and that peak is a real bound
          // because the agent-task worker pins maxConcurrentActivityTaskExecutions
          // to 1 (packages/temporal/src/worker.ts), so overlapping scheduled
          // tasks queue instead of multiplying provider subprocesses. Request
          // the measured p95 working set (249MiB over 7d, 2026-10-31) and
          // keep the 1GiB limit for task bursts.
          request: Size.mebibytes(256),
          limit: Size.gibibytes(1),
        },
      },
      ...temporalWorkerHealthProbes(),
      envVariables: props.envVariables,
    }),
  );

  const publicClusterCa = Volume.fromConfigMap(
    chart,
    `${name}-public-cluster-ca`,
    ConfigMap.fromConfigMapName(
      chart,
      `${name}-cluster-ca-config-map`,
      "kube-root-ca.crt",
    ),
    {
      name: "public-cluster-ca",
      items: { "ca.crt": { path: "ca.crt" } },
      defaultMode: 0o444,
    },
  );
  container.mount("/etc/kubernetes", publicClusterCa, { readOnly: true });

  // The root poller needs read-only Kubernetes evidence, but provider code runs
  // as uid/gid 1001 with supplementary groups cleared. This pod deliberately
  // has no fsGroup, so kubelet cannot grant the provider group access to the
  // owner-only projected token.
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
            downwardApi: {
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
    } satisfies k8s.Volume),
    JsonPatch.add("/spec/template/spec/containers/0/volumeMounts/-", {
      name: hiddenServiceAccountVolume,
      mountPath: "/var/run/secrets/kubernetes.io/serviceaccount",
      readOnly: true,
    }),
  );

  container.mount("/tmp", tmpVolume);

  const agentSelector = Pods.select(chart, `${name}-selector`, {
    labels: { component },
  });
  new Service(chart, `${name}-metrics-service`, {
    selector: agentSelector,
    metadata: {
      labels: { component: `${component}-metrics` },
    },
    ports: [{ port: 9464, name: "metrics" }],
  });

  createServiceMonitor(chart, {
    name: `${name}-metrics`,
    matchLabels: { component: `${component}-metrics` },
  });

  new Service(chart, `${name}-app-metrics-service`, {
    metadata: {
      name: `${name}-app-metrics`,
      labels: { component: `${component}-app-metrics` },
    },
    selector: agentSelector,
    ports: [{ name: "app-metrics", port: 9465, targetPort: 9465 }],
  });

  createServiceMonitor(chart, {
    name: `${name}-app-metrics`,
    port: "app-metrics",
    interval: "30s",
    matchLabels: { component: `${component}-app-metrics` },
  });

  return deployment;
}
