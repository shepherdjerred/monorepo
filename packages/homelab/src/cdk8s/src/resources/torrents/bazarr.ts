import {
  Cpu,
  ConfigMap,
  EnvValue,
  type PersistentVolumeClaim,
  Secret,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  LINUXSERVER_UID,
  LINUXSERVER_GID,
} from "@shepherdjerred/homelab/cdk8s/src/misc/linux-server.ts";
import { LinuxServerApp } from "@shepherdjerred/homelab/cdk8s/src/misc/third-party/linuxserver-app.ts";
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
const chineseScriptSource = await Bun.file(
  new URL("../../../config/bazarr/chinese_script.py", import.meta.url),
).text();
const assrtSource = await Bun.file(
  new URL("../../../config/bazarr/assrt.py", import.meta.url),
).text();
const providerRevision = new Bun.CryptoHasher("sha256")
  .update(providerSource)
  .update(policySource)
  .update(zimukuSource)
  .update(chineseScriptSource)
  .update(assrtSource)
  .digest("hex");

const PROVIDER_DIRECTORY =
  "/app/bazarr/bin/custom_libs/subliminal_patch/providers";
// Mounted file by file, so the image's built-in providers stay visible.
const MOUNTED_PROVIDERS = [
  "zimuku.py",
  "subhd.py",
  "chinese_script.py",
  "assrt.py",
];

export function createBazarrDeployment(
  chart: Chart,
  claims: {
    tv: PersistentVolumeClaim;
    movies: PersistentVolumeClaim;
  },
) {
  const image = `ghcr.io/linuxserver/bazarr:${versions["linuxserver/bazarr"]}`;

  new LinuxServerApp(chart, "bazarr-app", {
    name: "bazarr",
    image,
    port: 6767,
    fsGroup: false,
    podMetadata: {
      labels: { app: "bazarr" },
      annotations: { "checksum/subtitle-providers": providerRevision },
    },
    claims: [
      {
        claim: "bazarr-pvc",
        volumeId: "bazarr-volume",
        storage: Size.gibibytes(8),
        path: "/config",
      },
    ],
    extend: ([configVolume]) => {
      if (configVolume === undefined)
        throw new Error("bazarr: the config volume is missing");
      const providerConfig = new ConfigMap(chart, "bazarr-providers", {
        data: {
          "subhd.py": providerSource,
          "configure.py": policySource,
          "zimuku.py": zimukuSource,
          "chinese_script.py": chineseScriptSource,
          "assrt.py": assrtSource,
        },
      });
      const providerVolume = Volume.fromConfigMap(
        chart,
        "bazarr-providers-volume",
        providerConfig,
      );
      const tokenItem = new OnePasswordItem(chart, "bazarr-pinchtab-1p", {
        metadata: { name: "bazarr-pinchtab-token" },
        spec: { itemPath: vaultItemPath("t2dgtdx47yd2gegad6zeelzylu") },
      });
      return {
        init: [
          {
            name: "configure-subtitle-providers",
            image,
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
              memory: {
                request: Size.mebibytes(32),
                limit: Size.mebibytes(128),
              },
            },
            volumeMounts: [
              { path: "/providers", volume: providerVolume },
              { path: "/config", volume: configVolume },
            ],
          },
        ],
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
        volumeMounts: MOUNTED_PROVIDERS.map((provider) => ({
          path: `${PROVIDER_DIRECTORY}/${provider}`,
          subPath: provider,
          volume: providerVolume,
          readOnly: true,
        })),
      };
    },
    sharedMounts: [
      {
        volumeId: "bazarr-movies-hdd-volume",
        claim: claims.movies,
        path: "/movies",
      },
      { volumeId: "bazarr-tv-hdd-volume", claim: claims.tv, path: "/tv" },
    ],
    resources: {
      cpu: {
        request: Cpu.millis(50),
        limit: Cpu.millis(1000),
      },
      memory: {
        // Measured p95 working set (7d, 2026-10-31) is 524Mi.
        request: Size.mebibytes(640),
        // Bumped 2 → 3 GiB after the 2026-05-07 OOMKilled at the 2 GiB limit
        // (subtitle queue under load). 2 GiB was tight for steady-state.
        limit: Size.gibibytes(3),
      },
    },
    tailscale: { host: "bazarr", proxyClass: "medium" },
  });
}
