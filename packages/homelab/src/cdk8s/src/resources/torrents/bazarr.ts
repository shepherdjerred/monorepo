import {
  Cpu,
  ConfigMap,
  Deployment,
  DeploymentStrategy,
  EnvValue,
  type PersistentVolumeClaim,
  Service,
  Secret,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  LINUXSERVER_UID,
  LINUXSERVER_GID,
  withCommonLinuxServerProps,
} from "@shepherdjerred/homelab/cdk8s/src/misc/linux-server.ts";
import { ZfsNvmeVolume } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { setRevisionHistoryLimit } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

const providerSource = await Bun.file(
  new URL("../../../config/bazarr/subhd.py", import.meta.url),
).text();
const policySource = await Bun.file(
  new URL("../../../config/bazarr/configure.py", import.meta.url),
).text();
const zimukuSource = await Bun.file(
  new URL("../../../config/bazarr/zimuku.py", import.meta.url),
).text();
const providerRevision = new Bun.CryptoHasher("sha256")
  .update(providerSource)
  .update(policySource)
  .update(zimukuSource)
  .digest("hex");

export function createBazarrDeployment(
  chart: Chart,
  claims: {
    tv: PersistentVolumeClaim;
    movies: PersistentVolumeClaim;
  },
) {
  const deployment = new Deployment(chart, "bazarr", {
    replicas: 1,
    strategy: DeploymentStrategy.recreate(),
    podMetadata: {
      labels: { app: "bazarr" },
      annotations: { "checksum/subtitle-providers": providerRevision },
    },
    metadata: {
      annotations: {
        "ignore-check.kube-linter.io/run-as-non-root":
          "LinuxServer.io images run as root internally",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "LinuxServer.io images require writable filesystem",
      },
    },
  });

  const localPathVolume = new ZfsNvmeVolume(chart, "bazarr-pvc", {
    storage: Size.gibibytes(8),
  });
  const providerConfig = new ConfigMap(chart, "bazarr-providers", {
    data: {
      "subhd.py": providerSource,
      "configure.py": policySource,
      "zimuku.py": zimukuSource,
    },
  });
  const providerVolume = Volume.fromConfigMap(
    chart,
    "bazarr-providers-volume",
    providerConfig,
  );
  const configVolume = Volume.fromPersistentVolumeClaim(
    chart,
    "bazarr-volume",
    localPathVolume.claim,
  );
  const tokenItem = new OnePasswordItem(chart, "bazarr-pinchtab-1p", {
    metadata: { name: "bazarr-pinchtab-token" },
    spec: { itemPath: vaultItemPath("t2dgtdx47yd2gegad6zeelzylu") },
  });
  deployment.addInitContainer({
    name: "configure-subtitle-providers",
    image: `ghcr.io/linuxserver/bazarr:${versions["linuxserver/bazarr"]}`,
    command: ["python3", "/providers/configure.py"],
    envVariables: {
      PYTHONPATH: EnvValue.fromValue("/app/bazarr/bin/libs"),
      PUID: EnvValue.fromValue(String(LINUXSERVER_UID)),
      PGID: EnvValue.fromValue(String(LINUXSERVER_GID)),
    },
    securityContext: {
      ensureNonRoot: false,
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
    },
    resources: {
      cpu: { request: Cpu.millis(10), limit: Cpu.millis(100) },
      memory: { request: Size.mebibytes(32), limit: Size.mebibytes(128) },
    },
    volumeMounts: [
      { path: "/providers", volume: providerVolume },
      { path: "/config", volume: configVolume },
    ],
  });

  deployment.addContainer(
    withCommonLinuxServerProps({
      image: `ghcr.io/linuxserver/bazarr:${versions["linuxserver/bazarr"]}`,
      portNumber: 6767,
      envVariables: {
        TZ: EnvValue.fromValue(""),
        SUBHD_PINCHTAB_URL: EnvValue.fromValue(
          "http://pinchtab.pinchtab.svc.cluster.local:9867",
        ),
        SUBHD_PINCHTAB_PROFILE: EnvValue.fromValue("subhd"),
        SUBHD_PINCHTAB_TOKEN: EnvValue.fromSecretValue({
          secret: Secret.fromSecretName(
            chart,
            "bazarr-pinchtab-secret",
            tokenItem.name,
          ),
          key: "PINCHTAB_TOKEN",
        }),
      },
      volumeMounts: [
        {
          path: "/config",
          volume: configVolume,
        },
        {
          path: "/app/bazarr/bin/custom_libs/subliminal_patch/providers/zimuku.py",
          subPath: "zimuku.py",
          volume: providerVolume,
          readOnly: true,
        },
        {
          path: "/app/bazarr/bin/custom_libs/subliminal_patch/providers/subhd.py",
          subPath: "subhd.py",
          volume: providerVolume,
          readOnly: true,
        },
        {
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "bazarr-movies-hdd-volume",
            claims.movies,
          ),
          path: "/movies",
        },
        {
          volume: Volume.fromPersistentVolumeClaim(
            chart,
            "bazarr-tv-hdd-volume",
            claims.tv,
          ),
          path: "/tv",
        },
      ],
      resources: {
        cpu: {
          request: Cpu.millis(50),
          limit: Cpu.millis(1000),
        },
        memory: {
          request: Size.mebibytes(512),
          // Bumped 2 → 3 GiB after the 2026-05-07 OOMKilled at the 2 GiB limit
          // (subtitle queue under load). 2 GiB was tight for steady-state.
          limit: Size.gibibytes(3),
        },
      },
    }),
  );

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, "bazarr-service", {
    selector: deployment,
    ports: [{ port: 6767 }],
  });

  new TailscaleIngress(chart, "bazarr-tailscale-ingress", {
    service,
    host: "bazarr",
    proxyClass: "medium",
  });
}
