import { createForumCredentials } from "./credentials.ts";
import fs from "node:fs";
import path from "node:path";
import { Chart, type App } from "cdk8s";
import { Pods, Service } from "cdk8s-plus-31";
import {
  IntOrString,
  KubeConfigMap,
  KubeDeployment,
  KubeJob,
  KubeServiceAccount,
  Quantity,
  type Container,
  type EnvVar,
  type PodSpec,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { TailscaleIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { createHomelabIssuedCertificate } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/cert-manager.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createForumDatabase } from "./database.ts";
import { createForumNetwork } from "./network.ts";
import { createForumStorage } from "./storage.ts";
import { applyForumSyncWaves } from "./sync-waves.ts";
import {
  forumBootstrapEnvironment,
  forumRecoveryEnvironment,
} from "./upgrade-environment.ts";
import type { ForumRelease, ForumStage } from "./release-schema.ts";
import { forumTemplateInputs } from "./delivery-inputs.ts";

// The caller supplies verified published artifacts and provisioned secret IDs.
// No placeholder image digest, empty secret item, or automatic install on restart.
export function createStormForumChart(
  app: App,
  input: ForumRelease | ForumStage,
): Chart {
  const release = forumTemplateInputs(input);
  const namespace =
    release.stage === "beta" ? "storm-forum-beta" : "storm-forum";
  const chart = new Chart(app, namespace, {
    namespace,
    disableResourceNameHashes: true,
  });
  const { secret, observer } = createForumCredentials(chart, {
    namespace,
    secretItemId: release.secretItemId,
    ...(release.observationItemId === undefined
      ? {}
      : { observationItemId: release.observationItemId }),
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
  const bootstrap = forumBootstrapEnvironment(release);
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
              env: [
                ...(base.env ?? []),
                ...(observer === undefined
                  ? []
                  : [
                      {
                        name: "DELIVERY_FORUM_OBSERVATION_TOKEN",
                        valueFrom: {
                          secretKeyRef: {
                            name: observer.name,
                            key: "DELIVERY_FORUM_OBSERVATION_TOKEN",
                          },
                        },
                      },
                    ]),
              ],
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
                { name: "delivery-read", containerPort: 8082 },
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
                {
                  name: "RUNTIME_IMAGE",
                  value: release.image,
                },
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
      name: `storm-forum-release-${release.releaseId}`,
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
              command: ["bun", "/opt/storm-forum/src/cli.ts", "release"],
              env: [
                ...(base.env ?? []),
                ...forumRecoveryEnvironment(release),
                ...credentials([
                  "ADMIN_USERNAME",
                  "ADMIN_PASSWORD",
                  "ADMIN_EMAIL",
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
