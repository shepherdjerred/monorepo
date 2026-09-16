import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  EmptyDirMedium,
  EnvValue,
  Probe,
  Protocol,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import {
  NET_ADMIN_FIREWALL_RESOURCES,
  netAdminFirewallSecurityContext,
} from "@shepherdjerred/homelab/cdk8s/src/misc/net-admin-firewall.ts";

const PINCHTAB_PORT = 9867;

// pinchtab's /health route requires the bearer token (its "guard" mode rejects
// unauthenticated requests on every route except `/`). The probe runs inside the
// container, so it can read PINCHTAB_TOKEN from the env and authenticate without
// the token ever appearing in the manifest. wget exits non-zero on a 401/non-2xx,
// which is exactly the failure signal the probe needs.
const HEALTHCHECK_COMMAND = [
  "sh",
  "-c",
  `wget -q -O /dev/null --header="Authorization: Bearer $PINCHTAB_TOKEN" http://localhost:${String(PINCHTAB_PORT)}/health`,
];
const BROWSER_READINESS_COMMAND = [
  "sh",
  "-c",
  String.raw`wget -q -O - --header="Authorization: Bearer $PINCHTAB_TOKEN" http://localhost:${String(PINCHTAB_PORT)}/instances | tr '}' '\n' | grep '"profileName":"default"' | grep -Eq '"status":"running"'`,
];

export function createPinchtabDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "pinchtab", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    automountServiceAccountToken: false,
    securityContext: {
      // The pinchtab image runs Chrome as its own non-root user. fsGroup lets
      // that user (whatever its UID) write to the persisted /data PVC.
      fsGroup: 1000,
      ensureNonRoot: false,
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "pinchtab manages its own non-root user and runs Chrome with --no-sandbox in-container",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Chrome requires a writable filesystem for its user-data and cache directories",
      },
    },
    podMetadata: {
      annotations: {
        "ci.sjer.red/pod-security-enforcement": "privileged",
      },
    },
  });

  const firewallRunVolume = Volume.fromEmptyDir(
    chart,
    "pinchtab-firewall-run",
    "firewall-run",
  );
  deployment.addInitContainer(
    withCommonProps({
      name: "install-browser-firewall",
      image: `ghcr.io/shepherdjerred/birmel:${versions["shepherdjerred/birmel"]}`,
      command: ["/bin/sh", "-c"],
      args: [
        `set -eu
iptables -F OUTPUT
ip6tables -F OUTPUT
iptables -P OUTPUT DROP
ip6tables -P OUTPUT DROP
iptables -A OUTPUT -o lo -j ACCEPT
ip6tables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for address in $(awk '/^nameserver / { print $2 }' /etc/resolv.conf); do
  case "$address" in
    *:*)
      ip6tables -A OUTPUT -d "$address" -p udp --dport 53 -j ACCEPT
      ip6tables -A OUTPUT -d "$address" -p tcp --dport 53 -j ACCEPT
      ;;
    *)
      iptables -A OUTPUT -d "$address" -p udp --dport 53 -j ACCEPT
      iptables -A OUTPUT -d "$address" -p tcp --dport 53 -j ACCEPT
      ;;
  esac
done
for cidr in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4; do
  iptables -A OUTPUT -d "$cidr" -j REJECT
done
for cidr in ::/128 ::1/128 fc00::/7 fe80::/10 ff00::/8; do
  ip6tables -A OUTPUT -d "$cidr" -j REJECT
done
iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT
ip6tables -A OUTPUT -p tcp --dport 443 -j ACCEPT
iptables -L OUTPUT -n
ip6tables -L OUTPUT -n`,
      ],
      securityContext: netAdminFirewallSecurityContext(true),
      volumeMounts: [{ path: "/run", volume: firewallRunVolume }],
      resources: NET_ADMIN_FIREWALL_RESOURCES,
    }),
  );

  // Shared "PinchTab" 1Password item (also synced into the birmel namespace).
  // Single source of truth for the bearer token used by both pinchtab and birmel.
  const onePasswordItem = new OnePasswordItem(chart, "pinchtab-1p", {
    spec: {
      itemPath: vaultItemPath("t2dgtdx47yd2gegad6zeelzylu"),
    },
    metadata: {
      name: "pinchtab-token",
    },
  });

  // Persistent browser profiles, server state, and managed config.
  const dataVolume = new ZfsNvmeVolume(chart, "pinchtab-data", {
    storage: Size.gibibytes(10),
  });

  // PinchTab config. The bearer token is intentionally NOT stored here — it is
  // supplied via the PINCHTAB_TOKEN env var (from 1Password), which overrides
  // the config-file value. bind 0.0.0.0 is required so the Service can reach the
  // process; headless mode is required because there is no display in-cluster.
  const config = new ConfigMap(chart, "pinchtab-config", {
    metadata: {
      name: "pinchtab-config",
    },
    data: {
      // PinchTab 0.15.1 uses this marker to detect containers. Kubernetes CRI
      // does not supply Docker's marker, so Chrome otherwise tries a sandbox
      // that cannot run with no_new_privs. Retain the existing pod firewall.
      dockerenv: "",
      "config.json": JSON.stringify(
        {
          server: {
            bind: "0.0.0.0",
            // pinchtab's config schema types server.port as a string; emitting a
            // number makes the Go parser fail ("cannot unmarshal number into
            // ServerConfig.server.port of type string"), the server never binds,
            // and the pod crashloops on the /health startup probe.
            port: String(PINCHTAB_PORT),
            stateDir: "/data/state",
          },
          profiles: {
            baseDir: "/data/profiles",
            defaultProfile: "default",
          },
          instanceDefaults: {
            mode: "headless",
            noRestore: true,
            stealthLevel: "full",
            humanize: true,
          },
          security: { allowEvaluate: true },
        },
        null,
        2,
      ),
    },
  });
  deployment.podMetadata.addAnnotation(
    "checksum/browser-config",
    new Bun.CryptoHasher("sha256")
      .update(JSON.stringify(config.data))
      .digest("hex"),
  );
  const configVolume = Volume.fromConfigMap(
    chart,
    "pinchtab-config-volume",
    config,
  );

  deployment.addContainer(
    withCommonProps({
      image: `pinchtab/pinchtab:${versions["pinchtab/pinchtab"]}`,
      securityContext: {
        ensureNonRoot: false,
        // Chrome writes user-data/cache under $HOME; keep the root FS writable.
        // Can be hardened to readOnlyRootFilesystem with extra writable mounts
        // later if desired.
        readOnlyRootFilesystem: false,
        allowPrivilegeEscalation: false,
      },
      ports: [{ number: PINCHTAB_PORT, name: "http", protocol: Protocol.TCP }],
      resources: {
        cpu: {
          request: Cpu.millis(250),
          limit: Cpu.millis(2000),
        },
        memory: {
          // The 30d working-set peak is ~237MiB. Keep a rounded 512MiB
          // scheduler reservation, while the limit must still comfortably
          // exceed the 2Gi Memory-backed /dev/shm below plus Chrome's working
          // set.
          request: Size.mebibytes(512),
          limit: Size.gibibytes(4),
        },
      },
      envVariables: {
        PINCHTAB_CONFIG: EnvValue.fromValue("/config/config.json"),
        PINCHTAB_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "pinchtab-token-secret",
            onePasswordItem.name,
          ),
          key: "PINCHTAB_TOKEN",
        }),
      },
      // pinchtab 0.13.2 runs its "guard" with auth required on every route
      // except `/` — `/health` returns 401 without the bearer token, so a plain
      // httpGet probe fails. Use an exec probe that reads PINCHTAB_TOKEN from the
      // container env (never the manifest) and calls /health. Two-stage readiness:
      // the generous startup probe covers Chrome warm-up before liveness/readiness
      // take over.
      startup: Probe.fromCommand(HEALTHCHECK_COMMAND, {
        periodSeconds: Duration.seconds(5),
        failureThreshold: 24,
      }),
      liveness: Probe.fromCommand(HEALTHCHECK_COMMAND, {
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      readiness: Probe.fromCommand(BROWSER_READINESS_COMMAND, {
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
      volumeMounts: [
        {
          path: "/.dockerenv",
          subPath: "dockerenv",
          volume: configVolume,
          readOnly: true,
        },
        {
          path: "/data",
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "pinchtab-data-volume",
            dataVolume.claim,
          ),
        },
        {
          path: "/config",
          volume: configVolume,
        },
        {
          // Chrome needs far more shared memory than the container default 64Mi.
          path: "/dev/shm",
          volume: Volume.fromEmptyDir(chart, "pinchtab-shm", "shm", {
            medium: EmptyDirMedium.MEMORY,
            sizeLimit: Size.gibibytes(2),
          }),
        },
      ],
    }),
  );

  setRevisionHistoryLimit(deployment);

  // Service name + namespace must resolve to pinchtab.pinchtab.svc.cluster.local,
  // which is the PINCHTAB_BASE_URL birmel already points at.
  const service = new Service(chart, "pinchtab-service", {
    metadata: {
      name: "pinchtab",
    },
    selector: deployment,
    ports: [{ port: PINCHTAB_PORT, targetPort: PINCHTAB_PORT }],
  });

  // Tailnet access to the dashboard/API for debugging and profile login flows.
  new TailscaleIngress(chart, "pinchtab-tailscale-ingress", {
    service,
    host: "pinchtab",
    proxyClass: "medium",
  });

  return service;
}
