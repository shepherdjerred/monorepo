import { createHash } from "node:crypto";
import type { V1Job, V1PodSpec } from "@kubernetes/client-node";
import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { deliveryTofuGrants } from "homelab/src/delivery-platform-grants.ts";
import {
  DELIVERY_STAGE_LOCAL_QUEUE,
  DELIVERY_STAGE_REQUESTS,
  LEGACY_DELIVERY_STAGE_LOCAL_QUEUE,
} from "homelab/src/delivery-stage-admission.ts";
import {
  DELIVERY_JOB_BOOTSTRAP,
  PREVIOUS_DELIVERY_JOB_BOOTSTRAPS,
  DeliveryJobRequestSchema,
  deliveryJobArchive,
  deliveryJobNamespace,
  deliveryStageWorkspaceClaim,
  type DeliveryJobRequest,
} from "#shared/delivery-job.ts";
import { RecoveryJobInputSchema } from "./platform/recovery/request.ts";

const PREFIX = "delivery.shepherdjerred.com/";
const QUEUE_LABEL = "kueue.x-k8s.io/queue-name";
/** Logs only: the root filesystem is read-only and the workspace is a claim. */
const STAGE_EPHEMERAL_STORAGE_LIMIT = "4Gi";
/**
 * The workspace layout of Jobs created before the persistent stage claims: a
 * fresh emptyDir on the OS disk, sized and requested as ephemeral storage.
 * Adoption and recovery treat exactly that layout as the current one.
 */
const RETIRED_WORKSPACE_LAYOUT = {
  volume: { name: "workspace", emptyDir: { sizeLimit: "32Gi" } },
  ephemeralStorage: "32Gi",
} as const;
export function deliveryJobManifest(raw: DeliveryJobRequest): V1Job {
  const input = DeliveryJobRequestSchema.parse(raw);
  const hash = createHash("sha256").update(canonicalJson(input)).digest("hex");
  const name = `delivery-${hash.slice(0, 40)}`;
  const grants = jobGrants(input);
  const namespace = deliveryJobNamespace(input.recipe);
  const pullSecret = `dockerhub-pull-${namespace}`;
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name,
      namespace,
      labels: {
        app: "delivery-stage",
        [QUEUE_LABEL]: DELIVERY_STAGE_LOCAL_QUEUE,
      },
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
          serviceAccountName:
            input.recipe === "platform-recovery"
              ? "delivery-recovery-inspector"
              : "delivery-stage",
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
          imagePullSecrets: [{ name: pullSecret }],
          securityContext: {
            runAsUser: 1000,
            runAsGroup: 1000,
            fsGroup: 1000,
            // The workspace claim is chowned once, when first mounted, not
            // recursively across a checkout and node_modules on every Job.
            fsGroupChangePolicy: "OnRootMismatch",
            runAsNonRoot: true,
            seccompProfile: { type: "RuntimeDefault" },
          },
          volumes: [
            {
              name: "workspace",
              persistentVolumeClaim: {
                claimName: deliveryStageWorkspaceClaim(input.recipe),
              },
            },
            {
              name: "docker",
              secret: {
                secretName: pullSecret,
                items: [{ key: ".dockerconfigjson", path: "config.json" }],
              },
            },
            ...recoveryVolumes(input),
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
                ...(input.recipe === "platform-recovery"
                  ? [
                      {
                        name: "kubernetes",
                        mountPath:
                          "/var/run/secrets/kubernetes.io/serviceaccount",
                        readOnly: true,
                      },
                    ]
                  : []),
              ],
              env: [
                { name: "HOME", value: "/workspace/home" },
                { name: "TMPDIR", value: "/workspace/tmp" },
                { name: "DOCKER_CONFIG", value: "/var/run/delivery/docker" },
                { name: "BUILDX_CONFIG", value: "/workspace/buildx" },
                { name: "DELIVERY_JOB_REQUEST", value: canonicalJson(input) },
                {
                  name: "DELIVERY_SOURCE_REVISION",
                  value: input.sourceRevision,
                },
                {
                  name: "TEMPORAL_ADDRESS",
                  value:
                    "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
                },
                { name: "TEMPORAL_NAMESPACE", value: "prod" },
                ...(["control-plane", "platform-recovery"].includes(
                  input.recipe,
                )
                  ? [
                      {
                        name: "ARGOCD_SERVER_URL",
                        value: "https://argocd.sjer.red",
                      },
                    ]
                  : []),
                ...([
                  "tofu-apply",
                  "control-plane",
                  "platform-recovery",
                ].includes(input.recipe)
                  ? [
                      {
                        name: "DELIVERY_API_URL",
                        value:
                          "http://delivery.delivery.svc.cluster.local:7353",
                      },
                    ]
                  : []),
                ...(namespace === "delivery-platform-jobs"
                  ? [
                      {
                        name: "DELIVERY_JOB_UID",
                        valueFrom: {
                          fieldRef: {
                            fieldPath:
                              "metadata.labels['batch.kubernetes.io/controller-uid']",
                          },
                        },
                      },
                      { name: "DELIVERY_JOB_NAME", value: name },
                      { name: "DELIVERY_JOB_NAMESPACE", value: namespace },
                      { name: "DELIVERY_JOB_FINGERPRINT", value: hash },
                    ]
                  : []),
                ...grants.map(({ env, secret, key }) => ({
                  name: env,
                  valueFrom: { secretKeyRef: { name: secret, key } },
                })),
              ],
              resources: {
                requests: { ...DELIVERY_STAGE_REQUESTS },
                limits: {
                  cpu: "8",
                  memory: "16Gi",
                  "ephemeral-storage": STAGE_EPHEMERAL_STORAGE_LIMIT,
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
  if (input.recipe === "platform-recovery") {
    const frozen = RecoveryJobInputSchema.parse(input.input);
    return [
      {
        env: "DELIVERY_EXECUTOR_TOKEN",
        secret: "delivery-platform-api",
        key: "DELIVERY_EXECUTOR_TOKEN",
      },
      ...(frozen.target === "tofu"
        ? deliveryTofuGrants(z.string().parse(frozen.stack))
        : [
            {
              env: "ARGOCD_TOKEN",
              secret: "delivery-platform-argocd",
              key: "ARGOCD_TOKEN",
            },
          ]),
      // A model tofu recovery stages its frozen stack archive (X8).
      ...(frozen.archive === undefined ? [] : ARCHIVE_READER_GRANTS),
    ];
  }
  if (
    ["worker-images", "worker-preflight", "worker-step", "test"].includes(
      input.recipe,
    )
  )
    return [];
  if (input.recipe === "control-plane")
    return [
      {
        env: "ARGOCD_TOKEN",
        secret: "delivery-platform-argocd",
        key: "ARGOCD_TOKEN",
      },
      {
        env: "DELIVERY_EXECUTOR_TOKEN",
        secret: "delivery-platform-api",
        key: "DELIVERY_EXECUTOR_TOKEN",
      },
    ];
  const stack = tofuJobStack(input.input);
  return [
    ...deliveryTofuGrants(stack),
    ...(deliveryJobArchive(input) === undefined ? [] : ARCHIVE_READER_GRANTS),
    ...(input.recipe === "tofu-apply"
      ? [
          {
            env: "DELIVERY_EXECUTOR_TOKEN",
            secret: "delivery-platform-api",
            key: "DELIVERY_EXECUTOR_TOKEN",
          },
        ]
      : []),
  ];
}

/** Read-only artifact-store credential; provisioned as a Secret in `delivery-platform-jobs`. */
const ARCHIVE_READER_GRANTS: Grant[] = [
  {
    env: "DELIVERY_ARCHIVE_READER_ACCESS_KEY_ID",
    secret: "delivery-archive-reader",
    key: "DELIVERY_ARCHIVE_READER_ACCESS_KEY_ID",
  },
  {
    env: "DELIVERY_ARCHIVE_READER_SECRET_ACCESS_KEY",
    secret: "delivery-archive-reader",
    key: "DELIVERY_ARCHIVE_READER_SECRET_ACCESS_KEY",
  },
];

/**
 * The stack whose grants a Tofu Job gets. Its input is a v1 frozen snapshot
 * (bare or `{ snapshot, archive }`) or a model step `{ model, archive }`;
 * the Job itself validates the whole input.
 */
function tofuJobStack(input: unknown): string {
  const Stack = z.object({ stack: z.string() }).loose();
  const snapshot = z.object({ snapshot: Stack }).loose().safeParse(input);
  if (snapshot.success) return snapshot.data.snapshot.stack;
  const model = z.object({ model: Stack }).loose().safeParse(input);
  return model.success ? model.data.model.stack : Stack.parse(input).stack;
}

function recoveryVolumes(input: DeliveryJobRequest) {
  return input.recipe === "platform-recovery"
    ? [
        {
          name: "kubernetes",
          projected: {
            sources: [
              {
                serviceAccountToken: { path: "token", expirationSeconds: 3600 },
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
                      fieldRef: { fieldPath: "metadata.namespace" },
                    },
                  ],
                },
              },
            ],
          },
        },
      ]
    : [];
}

/** Kubernetes defaults are ignored; every execution-controlling input is compared. */
export function assertMatchingDeliveryJob(
  actual: V1Job,
  expected: V1Job,
): void {
  const e = expected.spec?.template.spec;
  const a = withCurrentWorkspace(
    withCurrentBootstrap(actual.spec?.template.spec),
    e,
  );
  if (
    !jobIdentityMatches(actual, expected) ||
    canonicalJson(normalizePod(a)) !== canonicalJson(normalizePod(e)) ||
    !jobPolicyMatches(actual)
  )
    throw new Error(
      "Existing delivery Job does not match its frozen request and execution policy",
    );
}

/**
 * A Job created by an earlier release keeps that release's reviewed bootstrap.
 * Treat exactly those retained commands as the current one so adoption and
 * recovery still compare every other execution input; any other command fails.
 */
function withCurrentBootstrap(pod: V1PodSpec | undefined) {
  const command =
    pod?.containers.length === 1 ? pod.containers[0]?.command : undefined;
  if (
    pod === undefined ||
    command?.length !== 3 ||
    command[0] !== "/bin/bash" ||
    command[1] !== "-c" ||
    !PREVIOUS_DELIVERY_JOB_BOOTSTRAPS.includes(command[2] ?? "")
  )
    return pod;
  const adopted = structuredClone(pod);
  for (const container of adopted.containers)
    container.command = ["/bin/bash", "-c", DELIVERY_JOB_BOOTSTRAP];
  return adopted;
}

/**
 * Exactly the retired layout: the 32Gi emptyDir, the matching ephemeral
 * request and limit, and no fsGroup change policy.
 */
function hasRetiredWorkspaceLayout(pod: V1PodSpec): boolean {
  const container = pod.containers.length === 1 ? pod.containers[0] : undefined;
  const workspace = pod.volumes?.find((volume) => volume.name === "workspace");
  const retiredVolume =
    workspace !== undefined &&
    canonicalJson(workspace) === canonicalJson(RETIRED_WORKSPACE_LAYOUT.volume);
  const retiredRequest =
    container?.resources?.requests?.["ephemeral-storage"] ===
    RETIRED_WORKSPACE_LAYOUT.ephemeralStorage;
  const retiredLimit =
    container?.resources?.limits?.["ephemeral-storage"] ===
    RETIRED_WORKSPACE_LAYOUT.ephemeralStorage;
  const noChangePolicy = pod.securityContext?.fsGroupChangePolicy === undefined;
  return noChangePolicy && retiredVolume && retiredRequest && retiredLimit;
}

/**
 * A Job created before the persistent stage claims keeps its emptyDir
 * workspace and 32Gi ephemeral-storage request. Treat exactly that retired
 * layout as the current claim, limit and fsGroup policy, so adoption and
 * recovery still compare every other execution input; any other workspace
 * volume or storage request fails.
 */
function withCurrentWorkspace(
  pod: V1PodSpec | undefined,
  expected: V1PodSpec | undefined,
): V1PodSpec | undefined {
  const expectedWorkspace = expected?.volumes?.find(
    (volume) => volume.name === "workspace",
  );
  if (
    pod === undefined ||
    expectedWorkspace === undefined ||
    !hasRetiredWorkspaceLayout(pod)
  )
    return pod;
  const adopted = structuredClone(pod);
  adopted.volumes = (adopted.volumes ?? []).map((volume) =>
    volume.name === "workspace" ? structuredClone(expectedWorkspace) : volume,
  );
  const resources = adopted.containers[0]?.resources;
  if (resources?.requests !== undefined && resources.limits !== undefined) {
    resources.requests["ephemeral-storage"] =
      DELIVERY_STAGE_REQUESTS["ephemeral-storage"];
    resources.limits["ephemeral-storage"] = STAGE_EPHEMERAL_STORAGE_LIMIT;
  }
  const fsGroupChangePolicy = expected?.securityContext?.fsGroupChangePolicy;
  if (
    fsGroupChangePolicy !== undefined &&
    adopted.securityContext !== undefined
  )
    adopted.securityContext.fsGroupChangePolicy = fsGroupChangePolicy;
  return adopted;
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
    metadata.namespace === expected.metadata?.namespace &&
    // Jobs created before Delivery's reserved queue name the CI-shared one.
    [DELIVERY_STAGE_LOCAL_QUEUE, LEGACY_DELIVERY_STAGE_LOCAL_QUEUE].includes(
      metadata.labels?.[QUEUE_LABEL] ?? "",
    ) &&
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

export function normalizePod(input: unknown): unknown {
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
  if (pod["serviceAccount"] === pod["serviceAccountName"])
    delete pod["serviceAccount"];
  for (const field of ["containers", "initContainers"]) {
    if (pod[field] === undefined) continue;
    pod[field] = z
      .array(z.record(z.string(), z.unknown()))
      .parse(pod[field])
      .map((container) => {
        return withoutDefaults(container, {
          imagePullPolicy: "IfNotPresent",
          terminationMessagePath: "/dev/termination-log",
          terminationMessagePolicy: "File",
        });
      });
  }
  pod["volumes"] = z
    .array(z.record(z.string(), z.unknown()))
    .parse(pod["volumes"])
    .map((volume) => {
      for (const field of ["secret", "projected", "configMap"]) {
        if (volume[field] === undefined) continue;
        const source = z.record(z.string(), z.unknown()).parse(volume[field]);
        if (source["defaultMode"] === 420) delete source["defaultMode"];
        volume[field] = source;
      }
      return volume;
    });
  return normalizeFieldReferences(pod);
}

function normalizeFieldReferences(input: unknown): unknown {
  if (Array.isArray(input))
    return input.map((item: unknown) => normalizeFieldReferences(item));
  if (input === null || typeof input !== "object") return input;
  return Object.fromEntries(
    Object.entries(input).map(([key, value]: [string, unknown]) => {
      if (key === "fieldRef")
        return [
          key,
          withoutDefaults(z.record(z.string(), z.unknown()).parse(value), {
            apiVersion: "v1",
          }),
        ];
      return [key, normalizeFieldReferences(value)];
    }),
  );
}
