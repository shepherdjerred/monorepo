import {
  Cpu,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  Node,
  NodeLabelQuery,
  Probe,
  Protocol,
  Secret,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  setRevisionHistoryLimit,
  withCommonProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

// Hostname of the Talos node where the Zooz ZST39 USB stick is plugged in.
// Update after physically inserting the stick (verify via `kubectl get nodes`).
const ZWAVE_NODE_HOSTNAME = "torvalds";

// Persistent USB device path on the host. Resolve via `ls -la /dev/serial/by-id/`
// on the target node after plugging in the stick. The by-id path survives reboots
// and USB re-enumeration; never use /dev/ttyUSB* or /dev/ttyACM* here.
const ZWAVE_HOST_DEVICE_PATH =
  "/dev/serial/by-id/usb-Zooz_800_Z-Wave_Stick_533D004242-if00";

export function createZwaveJsUiDeployment(chart: Chart) {
  const deployment = new Deployment(chart, "zwave-js-ui", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/privileged-container":
          "Required for USB serial device passthrough",
        "ignore-check.kube-linter.io/privilege-escalation-container":
          "Required when privileged is true",
        "ignore-check.kube-linter.io/run-as-non-root":
          "zwave-js-ui image runs as root for /dev access",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "zwave-js-ui writes runtime state to /usr/src/app/store",
      },
    },
    podMetadata: {
      labels: { app: "zwave-js-ui" },
    },
  });

  // 1Password item holding zwave-js-ui secrets. Required fields:
  //   sessionSecret               — random string used to sign session cookies
  //   s2AccessControlKey          — Z-Wave S2 Access Control network key
  //   s2AuthenticatedKey          — Z-Wave S2 Authenticated network key
  //   s2UnauthenticatedKey        — Z-Wave S2 Unauthenticated network key
  //   s0LegacyKey                 — Z-Wave S0 legacy network key
  // Generate via the zwave-js-ui Settings UI on first run, then mirror the
  // values back into 1Password so future redeploys preserve the radio's
  // S2 pairings.
  const secretsItem = new OnePasswordItem(chart, "zwave-js-ui-secrets", {
    spec: {
      itemPath: vaultItemPath("ertelv7tiogcwecrt3dxmjd2wi"),
    },
  });

  const secret = Secret.fromSecretName(
    chart,
    "zwave-js-ui-secret",
    secretsItem.name,
  );

  const claim = new ZfsNvmeVolume(chart, "zwave-js-ui-pvc", {
    storage: Size.gibibytes(2),
  });

  const storeVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "zwave-js-ui-store",
    claim.claim,
  );

  const usbVolume = Volume.fromHostPath(
    chart,
    "zwave-js-ui-usb",
    "zwave-js-ui-usb",
    {
      path: ZWAVE_HOST_DEVICE_PATH,
    },
  );

  deployment.addContainer(
    withCommonProps({
      image: `docker.io/zwavejs/zwave-js-ui:${versions["zwavejs/zwave-js-ui"]}`,
      ports: [
        { name: "ui", number: 8091, protocol: Protocol.TCP },
        { name: "ws", number: 3000, protocol: Protocol.TCP },
      ],
      envVariables: {
        SESSION_SECRET: EnvValue.fromSecretValue({
          secret,
          key: "sessionSecret",
        }),
        KEY_S2_ACCESS_CONTROL: EnvValue.fromSecretValue({
          secret,
          key: "s2AccessControlKey",
        }),
        KEY_S2_AUTHENTICATED: EnvValue.fromSecretValue({
          secret,
          key: "s2AuthenticatedKey",
        }),
        KEY_S2_UNAUTHENTICATED: EnvValue.fromSecretValue({
          secret,
          key: "s2UnauthenticatedKey",
        }),
        KEY_S0_LEGACY: EnvValue.fromSecretValue({
          secret,
          key: "s0LegacyKey",
        }),
      },
      volumeMounts: [
        { path: "/usr/src/app/store", volume: storeVolume },
        { path: "/dev/zwave", volume: usbVolume },
      ],
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
        privileged: true,
        allowPrivilegeEscalation: true,
      },
      // TCP-only probes: zwave-js-ui's /health endpoint requires both MQTT and
      // Z-Wave to be connected, which fails by design here (no MQTT broker, and
      // Z-Wave only connects after the serial port is configured in the UI).
      startup: Probe.fromTcpSocket({
        port: 8091,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 24,
      }),
      liveness: Probe.fromTcpSocket({
        port: 8091,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
      resources: {
        cpu: {
          request: Cpu.millis(50),
          limit: Cpu.millis(500),
        },
        memory: {
          request: Size.mebibytes(128),
          limit: Size.mebibytes(512),
        },
      },
    }),
  );

  // Pin to the node where the USB stick is physically attached. hostPath
  // volumes are node-local; without this the pod could schedule on a node
  // without the device.
  deployment.scheduling.attract(
    Node.labeled(
      NodeLabelQuery.is("kubernetes.io/hostname", ZWAVE_NODE_HOSTNAME),
    ),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "zwave-js-ui-service", {
    metadata: {
      name: "zwave-js-ui",
      labels: { app: "zwave-js-ui" },
    },
    selector: deployment,
    ports: [
      { name: "ui", port: 8091 },
      { name: "ws", port: 3000 },
    ],
  });

  // Web UI only — the WS endpoint stays cluster-internal and HA reaches it
  // via ws://zwave-js-ui.home.svc.cluster.local:3000.
  new TailscaleIngress(chart, "zwave-js-ui-tailscale-ingress", {
    service,
    host: "zwave",
    port: 8091,
  });
}
