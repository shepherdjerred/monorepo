import fs from "node:fs";
import path from "node:path";
import { Chart, type App } from "cdk8s";
import { Pods, Service } from "cdk8s-plus-31";
import { z } from "zod";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  IntOrString,
  KubeConfigMap,
  KubeDeployment,
  KubeJob,
  KubeNamespace,
  KubeServiceAccount,
  Quantity,
  type Container,
  type EnvVar,
  type PodSpec,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { createHomelabIssuedCertificate } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/cert-manager.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createForumDatabase } from "./database.ts";
import { createForumNetwork } from "./network.ts";
import { createForumStorage } from "./storage.ts";
import { applyForumSyncWaves } from "./sync-waves.ts";
import { upgradeBackupEnvironment } from "./upgrade-environment.ts";

export const ReleaseSchema = z
  .object({
    stage: z.enum(["beta", "prod"]),
    image: z
      .string()
      .regex(/^ghcr\.io\/shepherdjerred\/storm-forum@sha256:[a-f0-9]{64}$/)
      .refine(
        (value) => !value.endsWith("0".repeat(64)),
        "An active release requires a published image",
      ),
    secretItemId: z.string().regex(/^[a-z0-9]{26}$/),
    bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
    bundleKey: z.string().regex(/^releases\/[\w.-]+\.zip$/),
    releaseId: z.string().regex(/^[a-f0-9]{12}$/),
    preUpgradeBackup: z
      .object({
        bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
        xenforoVersion: z.string().min(1),
        runtimeImage: z
          .string()
          .regex(/^ghcr\.io\/shepherdjerred\/storm-forum@sha256:[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
    storageSlot: z.enum(["primary", "recovery"]).optional(),
    restore: z
      .object({
        manifestKey: z
          .string()
          .regex(/^snapshots\/(?:beta|prod)\/[a-f0-9-]{36}\/manifest\.json$/),
      })
      .strict()
      .optional(),
    trustedConnectorCidr: z
      .cidrv4()
      .refine(
        (value) => value !== "0.0.0.0/0",
        "Trust only the connector's network",
      ),
  })
  .strict()
  .refine(
    (value) =>
      (value.storageSlot !== "recovery" || value.stage === "beta") &&
      (!value.restore ||
        (value.stage === "beta" && value.storageSlot === "recovery")),
    "Recovery uses only the dedicated private beta storage pair",
  );
export type ForumRelease = z.infer<typeof ReleaseSchema>;

// The caller supplies verified published artifacts and provisioned secret IDs.
// No placeholder image digest, empty secret item, or automatic install on restart.
export function createStormForumChart(app: App, input: ForumRelease): Chart {
  const release = ReleaseSchema.parse(input);
  const namespace =
    release.stage === "beta" ? "storm-forum-beta" : "storm-forum";
  const chart = new Chart(app, namespace, {
    namespace,
    disableResourceNameHashes: true,
  });
  new KubeNamespace(chart, "namespace", {
    metadata: {
      name: namespace,
      labels: { "pod-security.kubernetes.io/enforce": "restricted" },
    },
  });
  const secret = new OnePasswordItem(chart, "credentials", {
    metadata: { name: "storm-forum-secrets" },
    spec: { itemPath: vaultItemPath(release.secretItemId) },
  });
  const storage = createForumStorage(
    chart,
    release.stage,
    release.storageSlot ?? "primary",
  );
  createForumDatabase(chart, secret.name, storage.database.claim.name);
  createHomelabIssuedCertificate(chart, "smtp-ca", {
    name: "storm-forum-smtp-ca",
    namespace,
    secretName: "storm-forum-smtp-ca",
    commonName: "storm-forum-smtp-ca",
    dnsNames: [`storm-forum.${namespace}.svc.cluster.local`],
  });
  new KubeServiceAccount(chart, "worker-account", {
    metadata: { name: "storm-forum-worker" },
    automountServiceAccountToken: false,
  });
  const configuration = new KubeConfigMap(chart, "nginx-config", {
    data: { "nginx.conf": nginxConfiguration(release) },
  });
  const credentials = (names: readonly string[]): EnvVar[] =>
    names.map((name) => ({
      name,
      valueFrom: { secretKeyRef: { name: secret.name, key: name } },
    }));
  const bootstrap: EnvVar[] = [
    { name: "STORM_FORUM_STAGE", value: release.stage },
    { name: "DB_HOST", value: "storm-forum-database" },
    { name: "DB_NAME", value: "storm" },
    { name: "DB_USER", value: "storm" },
    {
      name: "BUNDLE_ENDPOINT",
      value: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
    },
    { name: "BUNDLE_BUCKET", value: "storm-forum-releases" },
    { name: "BUNDLE_KEY", value: release.bundleKey },
    { name: "BUNDLE_SHA256", value: release.bundleSha256 },
  ];
  const sharedMounts = [
    { name: "application", mountPath: "/app/forum" },
    { name: "files", mountPath: "/var/lib/storm-forum" },
    { name: "tmp", mountPath: "/tmp" },
  ];
  const base: Container = {
    name: "php",
    image: release.image,
    env: [
      ...bootstrap,
      ...credentials([
        "DB_PASSWORD",
        "POSTAL_SMTP_USERNAME",
        "POSTAL_SMTP_PASSWORD",
        "TURNSTILE_SITE_KEY",
        "TURNSTILE_SECRET_KEY",
      ]),
    ],
    securityContext: {
      runAsUser: 1000,
      runAsGroup: 1000,
      runAsNonRoot: true,
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
    },
    resources: {
      requests: {
        cpu: Quantity.fromString("100m"),
        memory: Quantity.fromString("256Mi"),
      },
      limits: {
        cpu: Quantity.fromString("2"),
        memory: Quantity.fromString("1Gi"),
      },
    },
    volumeMounts: sharedMounts,
  };
  const pod: PodSpec = {
    serviceAccountName: "storm-forum-worker",
    automountServiceAccountToken: false,
    securityContext: {
      fsGroup: 1000,
      seccompProfile: { type: "RuntimeDefault" },
    },
    terminationGracePeriodSeconds: 90,
    initContainers: [
      {
        ...base,
        name: "assemble",
        command: ["bun", "/opt/storm-forum/src/cli.ts", "assemble"],
        env: [
          ...bootstrap,
          ...credentials(["BUNDLE_ACCESS_KEY", "BUNDLE_SECRET_KEY"]),
        ],
        volumeMounts: [
          ...sharedMounts,
          { name: "smtp-ca", mountPath: "/etc/postal", readOnly: true },
        ],
      },
    ],
    containers: [],
    volumes: [
      { name: "application", emptyDir: {} },
      { name: "tmp", emptyDir: {} },
      {
        name: "files",
        persistentVolumeClaim: { claimName: storage.files.claim.name },
      },
      { name: "configuration", configMap: { name: configuration.name } },
      {
        name: "smtp-ca",
        secret: {
          secretName: "storm-forum-smtp-ca",
          items: [{ key: "ca.crt", path: "ca.crt" }],
        },
      },
      {
        name: "kubernetes",
        projected: {
          sources: [
            { serviceAccountToken: { path: "token", expirationSeconds: 3600 } },
            {
              configMap: {
                name: "kube-root-ca.crt",
                items: [{ key: "ca.crt", path: "ca.crt" }],
              },
            },
          ],
        },
      },
      ...(release.stage === "beta"
        ? [
            {
              name: "staging-auth",
              secret: {
                secretName: secret.name,
                items: [{ key: "STAGING_HTTP_AUTH", path: "staging.htpasswd" }],
              },
            },
          ]
        : []),
    ],
  };
  const labels = { app: "storm-forum", component: "web" };
  new KubeDeployment(chart, "web", {
    metadata: { name: "storm-forum-web" },
    spec: {
      replicas: 1,
      revisionHistoryLimit: 5,
      strategy: { type: "Recreate" },
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          ...pod,
          containers: [
            {
              ...base,
              volumeMounts: sharedMounts.map((mount) =>
                mount.name === "application"
                  ? { ...mount, readOnly: true }
                  : mount,
              ),
            },
            {
              ...base,
              name: "nginx",
              image: `nginx:${versions["library/nginx"]}`,
              env: [],
              command: ["nginx", "-g", "daemon off;"],
              ports: [
                { name: "http", containerPort: 8080 },
                { name: "admin", containerPort: 8081 },
              ],
              volumeMounts: [
                ...sharedMounts.map((mount) =>
                  mount.name === "tmp" ? mount : { ...mount, readOnly: true },
                ),
                {
                  name: "configuration",
                  mountPath: "/etc/nginx/nginx.conf",
                  subPath: "nginx.conf",
                  readOnly: true,
                },
                ...(release.stage === "beta"
                  ? [
                      {
                        name: "staging-auth",
                        mountPath: "/etc/storm-forum",
                        readOnly: true,
                      },
                    ]
                  : []),
              ],
              startupProbe: {
                httpGet: { path: "/livez", port: IntOrString.fromNumber(8080) },
                periodSeconds: 2,
                failureThreshold: 30,
              },
              livenessProbe: {
                httpGet: { path: "/livez", port: IntOrString.fromNumber(8080) },
                periodSeconds: 30,
              },
              readinessProbe: {
                httpGet: {
                  path: "/readyz",
                  port: IntOrString.fromNumber(8080),
                },
                periodSeconds: 10,
              },
            },
            {
              ...base,
              name: "activities",
              command: ["bun", "/opt/storm-forum/src/cli.ts", "worker"],
              volumeMounts: [
                ...sharedMounts,
                {
                  name: "kubernetes",
                  mountPath: "/var/run/secrets/kubernetes.io/serviceaccount",
                  readOnly: true,
                },
              ],
              env: [
                ...(base.env ?? []),
                { name: "RUNTIME_IMAGE", value: release.image },
                ...credentials(["BACKUP_ACCESS_KEY", "BACKUP_SECRET_KEY"]),
                {
                  name: "BACKUP_ENDPOINT",
                  value: "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
                },
                { name: "BACKUP_BUCKET", value: "storm-forum-backups" },
                {
                  name: "TEMPORAL_ADDRESS",
                  value:
                    "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
                },
                { name: "TEMPORAL_NAMESPACE", value: "prod" },
                { name: "FEATURE_FLAGS_MODE", value: "flipt" },
                { name: "FLIPT_NAMESPACE", value: "storm" },
                { name: "FLIPT_ENVIRONMENT", value: release.stage },
                {
                  name: "FLIPT_URL",
                  value:
                    "http://flipt-flipt-service.flipt.svc.cluster.local:8080",
                },
              ],
            },
          ],
        },
      },
    },
  });
  const selector = Pods.select(chart, "web-selector", { labels });
  const service = new Service(chart, "http-service", {
    metadata: { name: "storm-forum" },
    selector,
    ports: [{ port: 8080, name: "http" }],
  });
  const adminService = new Service(chart, "admin-service", {
    metadata: { name: "storm-forum-admin" },
    selector,
    ports: [{ port: 8081, name: "admin" }],
  });
  new TailscaleIngress(chart, "admin", {
    host: `${namespace}-admin`,
    service: adminService,
    port: 8081,
    probeModule: "tcp_connect",
  });
  if (release.stage === "beta") {
    new TailscaleIngress(chart, "staging", {
      host: namespace,
      service,
      port: 8080,
      probePath: "/readyz",
    });
  } else {
    createCloudflareTunnelBinding(chart, "public-forum", {
      fqdn: "ts-mc.net",
      serviceName: service.name,
      port: 8080,
      probePath: "/readyz",
    });
  }
  new KubeJob(chart, "release", {
    metadata: {
      name: `storm-forum-${release.restore ? "restore" : "release"}-${release.releaseId}`,
    },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: 3600,
      template: {
        metadata: { labels: { app: "storm-forum", component: "release" } },
        spec: {
          ...pod,
          restartPolicy: "Never",
          containers: [
            {
              ...base,
              name: "release",
              command: [
                "bun",
                "/opt/storm-forum/src/cli.ts",
                release.restore ? "restore" : "release",
              ],
              env: [
                ...(base.env ?? []),
                ...(release.restore || release.preUpgradeBackup
                  ? [{ name: "RUNTIME_IMAGE", value: release.image }]
                  : []),
                ...(release.restore
                  ? [
                      ...["ACCESS_KEY", "SECRET_KEY"].map((suffix) => ({
                        name: `BACKUP_${suffix}`,
                        valueFrom: {
                          secretKeyRef: {
                            name: secret.name,
                            key: `RESTORE_${suffix}`,
                          },
                        },
                      })),
                      {
                        name: "BACKUP_ENDPOINT",
                        value:
                          "http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333",
                      },
                      { name: "BACKUP_BUCKET", value: "storm-forum-backups" },
                      {
                        name: "RESTORE_MANIFEST_KEY",
                        value: release.restore.manifestKey,
                      },
                    ]
                  : [
                      ...credentials([
                        "ADMIN_USERNAME",
                        "ADMIN_PASSWORD",
                        "ADMIN_EMAIL",
                      ]),
                      ...(release.preUpgradeBackup
                        ? upgradeBackupEnvironment(
                            release.preUpgradeBackup,
                            credentials,
                          )
                        : []),
                    ]),
                {
                  name: "FORUM_URL",
                  value:
                    release.stage === "beta"
                      ? "https://storm-forum-beta.tailnet-1a49.ts.net"
                      : "https://ts-mc.net",
                },
              ],
            },
          ],
        },
      },
    },
  });
  createForumNetwork(chart, release.stage);
  applyForumSyncWaves(chart);
  return chart;
}

function nginxConfiguration(release: ForumRelease): string {
  let config = fs.readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../../../../../storm-forum/runtime/nginx.conf",
    ),
    "utf8",
  );
  config = config.replace(
    "# The chart renders trusted Cloudflare connector addresses, never 0.0.0.0/0.",
    `set_real_ip_from ${release.trustedConnectorCidr};\n  real_ip_header CF-Connecting-IP;`,
  );
  if (release.stage === "beta") {
    config = config.replace(
      "listen 8080;",
      'listen 8080;\n    auth_basic "The Storm private test forum";\n    auth_basic_user_file /etc/storm-forum/staging.htpasswd;',
    );
    config = config
      .replace("location = /livez {", "location = /livez { auth_basic off;")
      .replace("location = /readyz {", "location = /readyz { auth_basic off;");
  }
  return config;
}
