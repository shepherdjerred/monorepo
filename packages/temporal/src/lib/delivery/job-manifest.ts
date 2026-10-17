import { createHash } from "node:crypto";
import type { V1Job } from "@kubernetes/client-node";
import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  DELIVERY_JOB_BOOTSTRAP,
  DeliveryJobRequestSchema,
  type DeliveryJobRequest,
} from "#shared/delivery-job.ts";

const PREFIX = "delivery.shepherdjerred.com/";
export function deliveryJobManifest(raw: DeliveryJobRequest): V1Job {
  const input = DeliveryJobRequestSchema.parse(raw);
  const hash = createHash("sha256").update(canonicalJson(input)).digest("hex");
  const name = `delivery-${hash.slice(0, 40)}`;
  const grants = jobGrants(input);
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name,
      namespace: "delivery-jobs",
      labels: { app: "delivery-stage", "kueue.x-k8s.io/queue-name": "default" },
      annotations: {
        [`${PREFIX}request`]: input.deploymentId,
        [`${PREFIX}fingerprint`]: hash,
      },
    },
    spec: {
      suspend: true,
      parallelism: 1,
      completions: 1,
      backoffLimit: 0,
      activeDeadlineSeconds: 7200,
      template: {
        metadata: { labels: { app: "delivery-stage" } },
        spec: {
          restartPolicy: "Never",
          serviceAccountName: "delivery-stage",
          automountServiceAccountToken: false,
          priorityClassName: "batch-low",
          nodeSelector: { "kubernetes.io/hostname": "liskov" },
          tolerations: [
            {
              key: "ci",
              operator: "Equal",
              value: "only",
              effect: "NoSchedule",
            },
          ],
          imagePullSecrets: [{ name: "dockerhub-pull-delivery-jobs" }],
          securityContext: {
            runAsUser: 1000,
            runAsGroup: 1000,
            fsGroup: 1000,
            runAsNonRoot: true,
            seccompProfile: { type: "RuntimeDefault" },
          },
          volumes: [
            { name: "workspace", emptyDir: { sizeLimit: "32Gi" } },
            {
              name: "docker",
              secret: {
                secretName: "dockerhub-pull-delivery-jobs",
                items: [{ key: ".dockerconfigjson", path: "config.json" }],
              },
            },
          ],
          containers: [
            {
              name: "stage",
              image: input.runnerImage,
              command: ["/bin/bash", "-c", DELIVERY_JOB_BOOTSTRAP],
              workingDir: "/workspace",
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
              volumeMounts: [
                { name: "workspace", mountPath: "/workspace" },
                {
                  name: "docker",
                  mountPath: "/var/run/delivery/docker",
                  readOnly: true,
                },
              ],
              env: [
                { name: "HOME", value: "/workspace/home" },
                { name: "TMPDIR", value: "/workspace/tmp" },
                { name: "DOCKER_CONFIG", value: "/var/run/delivery/docker" },
                { name: "DELIVERY_JOB_REQUEST", value: canonicalJson(input) },
                {
                  name: "DELIVERY_SOURCE_REVISION",
                  value: input.sourceRevision,
                },
                {
                  name: "TEMPORAL_ADDRESS",
                  value: "temporal-server.temporal.svc.cluster.local:7233",
                },
                { name: "TEMPORAL_NAMESPACE", value: "prod" },
                ...grants.map(({ env, secret, key }) => ({
                  name: env,
                  valueFrom: { secretKeyRef: { name: secret, key } },
                })),
              ],
              resources: {
                requests: {
                  cpu: "2",
                  memory: "8Gi",
                  "ephemeral-storage": "32Gi",
                },
                limits: {
                  cpu: "8",
                  memory: "16Gi",
                  "ephemeral-storage": "32Gi",
                },
              },
            },
          ],
        },
      },
    },
  };
}

type Grant = { env: string; secret: string; key: string };
function jobGrants(input: DeliveryJobRequest): Grant[] {
  if (input.recipe === "worker-preflight" || input.recipe === "worker-step")
    return [
      {
        env: "GRAFANA_API_KEY",
        secret: "delivery-worker-proofs",
        key: "password",
      },
    ];
  if (input.recipe === "root-release")
    return [
      {
        env: "ARGOCD_TOKEN",
        secret: "delivery-root-release",
        key: "ARGOCD_TOKEN",
      },
    ];
  const stack = z.object({ stack: z.string() }).parse(input.input).stack;
  return tofuJobGrants(stack);
}

/** Exact per-stack grants; operator-only stacks have no execution recipe. */
function tofuJobGrants(stack: string): Grant[] {
  const state = [
    "SEAWEEDFS_TOFU_STATE_ACCESS_KEY_ID",
    "SEAWEEDFS_TOFU_STATE_SECRET_ACCESS_KEY",
  ].map((key) => ({ env: key, secret: "ci-seaweedfs-credentials", key }));
  const definitions: Readonly<
    Record<string, readonly [string, readonly string[]][]>
  > = {
    seaweedfs: [
      [
        "ci-seaweedfs-credentials",
        [
          "SEAWEEDFS_TOFU_ADMIN_ACCESS_KEY_ID",
          "SEAWEEDFS_TOFU_ADMIN_SECRET_ACCESS_KEY",
        ],
      ],
    ],
    tailscale: [
      [
        "ci-tailscale-credentials",
        ["TAILSCALE_OAUTH_CLIENT_ID", "TAILSCALE_OAUTH_CLIENT_SECRET"],
      ],
    ],
    github: [["ci-github-credentials", ["TOFU_GITHUB_TOKEN"]]],
    cloudflare: [
      [
        "ci-cloudflare-credentials",
        ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
      ],
    ],
  };
  const grants = definitions[stack];
  if (grants === undefined)
    throw new Error(
      `No reviewed Delivery Job credential recipe for OpenTofu stack ${stack}`,
    );
  return [
    ...state,
    ...grants.flatMap(([secret, keys]) =>
      keys.map((key) => ({ env: key, secret, key })),
    ),
  ];
}

/** Kubernetes defaults are ignored; every execution-controlling input is compared. */
export function assertMatchingDeliveryJob(
  actual: V1Job,
  expected: V1Job,
): void {
  const a = actual.spec?.template.spec;
  const e = expected.spec?.template.spec;
  if (
    !jobIdentityMatches(actual, expected) ||
    canonicalJson(normalizePod(a)) !== canonicalJson(normalizePod(e)) ||
    !jobPolicyMatches(actual)
  )
    throw new Error(
      "Existing delivery Job does not match its frozen request and execution policy",
    );
}

function jobIdentityMatches(actual: V1Job, expected: V1Job): boolean {
  const metadata = actual.metadata;
  return (
    metadata !== undefined &&
    metadata.name === expected.metadata?.name &&
    metadata.annotations?.[`${PREFIX}request`] ===
      expected.metadata?.annotations?.[`${PREFIX}request`] &&
    metadata.annotations?.[`${PREFIX}fingerprint`] ===
      expected.metadata?.annotations?.[`${PREFIX}fingerprint`] &&
    metadata.namespace === "delivery-jobs" &&
    metadata.labels?.["kueue.x-k8s.io/queue-name"] === "default" &&
    actual.spec?.template.metadata?.labels?.["app"] === "delivery-stage"
  );
}

function jobPolicyMatches(job: V1Job): boolean {
  const spec = job.spec;
  return (
    spec?.parallelism === 1 &&
    spec.completions === 1 &&
    spec.backoffLimit === 0 &&
    spec.activeDeadlineSeconds === 7200 &&
    spec.podFailurePolicy === undefined &&
    spec.successPolicy === undefined &&
    (spec.managedBy === undefined ||
      spec.managedBy === "kubernetes.io/job-controller")
  );
}

function withoutDefaults(
  input: Record<string, unknown>,
  defaults: Record<string, unknown>,
) {
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => defaults[key] !== value),
  );
}

function normalizePod(input: unknown): unknown {
  const parsed = z
    .record(z.string(), z.unknown())
    .parse(structuredClone(input));
  const pod = withoutDefaults(parsed, {
    dnsPolicy: "ClusterFirst",
    schedulerName: "default-scheduler",
    terminationGracePeriodSeconds: 30,
    enableServiceLinks: true,
    serviceAccount: "delivery-stage",
  });
  pod["containers"] = z
    .array(z.record(z.string(), z.unknown()))
    .parse(pod["containers"])
    .map((container) => {
      return withoutDefaults(container, {
        imagePullPolicy: "IfNotPresent",
        terminationMessagePath: "/dev/termination-log",
        terminationMessagePolicy: "File",
      });
    });
  pod["volumes"] = z
    .array(z.record(z.string(), z.unknown()))
    .parse(pod["volumes"])
    .map((volume) => {
      if (volume["secret"] !== undefined) {
        const secret = z
          .record(z.string(), z.unknown())
          .parse(volume["secret"]);
        if (secret["defaultMode"] === 420) delete secret["defaultMode"];
        volume["secret"] = secret;
      }
      return volume;
    });
  return pod;
}
