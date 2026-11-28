import { KubeConfig, type V1Job, type V1Pod } from "@kubernetes/client-node";
import {
  ContentRecoveryContextSchema,
  type ArtifactVersion,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { stepRecipeOf } from "@shepherdjerred/delivery/model-contract";
import {
  FORUM_RECOVERY_ANNOTATIONS,
  FORUM_RECOVERY_IMAGE_ABI,
  FORUM_RECOVERY_IMAGE_LABEL,
} from "@shepherdjerred/ops-model/forum-recovery.ts";
import { forumNativeObservation } from "@shepherdjerred/ops-model/forum/native-observation.ts";
import { expect, test, vi } from "vitest";
import {
  argoApplicationRequest,
  DELIVERY_ENVIRONMENT_ANNOTATION,
} from "#lib/delivery/argo-client.ts";
import * as forumJobs from "#lib/delivery/content-recovery/forum-jobs.ts";
import { forumReleaseId } from "#lib/delivery/forum.ts";
import { renderApplication } from "#lib/delivery/model/application.ts";
import {
  forumDeployment,
  forumRecipe,
} from "#lib/delivery/model/forum-testing.ts";
import { digest } from "#lib/delivery/model/testing.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { inspectForumPrior } from "./content-delivery-recovery-forum-prior.ts";
import {
  requireForumPreMigration,
  requireSameForumAssemblyLayers,
} from "./content-delivery-recovery-forum-prior-native.ts";

vi.mock("#lib/delivery/content-recovery/forum-jobs.ts", async (load) => ({
  ...(await load<typeof forumJobs>()),
  originalForumRecoveryJob: vi.fn(),
}));

vi.mock(import("#lib/delivery/argo-client.ts"), async (load) => ({
  ...(await load()),
  argoApplicationRequest: vi.fn(),
}));

function useKubernetesFixture(fetch: (request: Request) => Response) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
  const config = new KubeConfig();
  config.loadFromOptions({
    clusters: [
      { name: "fixture", server: server.url.origin, skipTLSVerify: true },
    ],
    users: [{ name: "fixture" }],
    contexts: [{ name: "fixture", cluster: "fixture", user: "fixture" }],
    currentContext: "fixture",
  });
  return {
    config,
    origin: server.url.origin,
    stop: async () => {
      await server.stop(true);
    },
  };
}

const current = forumDeployment(forumRecipe);
const image = current.versionSet.components["image:storm-forum"];
const bundle = current.versionSet.components["archive:forum-bundle"];
if (image === undefined || bundle === undefined)
  throw new Error("Forum fixture lacks its release");
const namespace = "storm-forum";
const imageReference = `${image.uri}@${image.digest}`;
const { digest: bundleDigest, version: bundleVersion } = bundle;
const bundleHash = bundleDigest.slice(7);
const bundlePath = `releases/${bundleHash}.zip`;
const intentId = "forum/test-guard";
const missingJournal =
  "error: Legacy Forum release has no native phase journal; inspect its retained original Job and use reviewed native repair, never remove markers or retry a migration blindly";

function container(name: string) {
  return {
    name,
    image: imageReference,
    command: ["bun", "/opt/storm-forum/src/cli.ts", name],
  };
}

function failedRelease() {
  return {
    metadata: {
      namespace,
      name: "original-forum-release",
      uid: crypto.randomUUID(),
    },
    spec: {
      template: {
        spec: {
          restartPolicy: "Never",
          volumes: [],
          initContainers: [container("assemble")],
          containers: [
            {
              ...container("release"),
              env: [
                {
                  name: "FORUM_RECOVERY_INTENT_ID",
                  valueFrom: {
                    fieldRef: {
                      fieldPath: `metadata.annotations['${FORUM_RECOVERY_ANNOTATIONS.intent}']`,
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    },
    status: { conditions: [{ type: "Failed", status: "True" }] },
  } satisfies V1Job;
}

function jobReceipt(job: ReturnType<typeof failedRelease>) {
  return {
    ...job.metadata,
    specFingerprint: forumJobs.forumJobFingerprint(job),
    requestId: "forum/fixture",
  };
}

function releasePod(
  job: V1Job,
  releaseState: "never-started" | "ran" | "repair",
) {
  const repair = releaseState === "repair";
  const base = { image: imageReference, ready: false, restartCount: 0 };
  return {
    metadata: {
      namespace,
      name: repair ? "repair-pod" : "original-pod",
      ownerReferences: [
        {
          apiVersion: "batch/v1",
          kind: "Job",
          name: job.metadata?.name,
          uid: job.metadata?.uid,
          controller: true,
        },
      ],
    },
    spec: job.spec?.template.spec,
    status: {
      phase: "Failed",
      initContainerStatuses: [
        {
          ...base,
          name: "assemble",
          imageID: imageReference,
          state: { terminated: { exitCode: repair ? 0 : 1 } },
        },
      ],
      containerStatuses: [
        {
          ...base,
          name: "release",
          imageID: repair ? imageReference : "",
          ...(releaseState === "ran"
            ? { containerID: "containerd://unexpected" }
            : {}),
          state: repair
            ? { terminated: { exitCode: 1 } }
            : { waiting: { reason: "PodInitializing" } },
        },
      ],
    },
  };
}

function receiptsFixture(
  scenario: "original" | "repair" | "ran" | "other-error",
  additionalResponse?: (url: URL) => Response | undefined,
) {
  const original = failedRelease();
  const originalReceipt = jobReceipt(original);
  const context = ContentRecoveryContextSchema.parse({
    intent: {
      id: intentId,
      deploymentId: current.deployment.id,
      requestedBy: "operator",
      reason: "Observe unaltered native state",
      expectedEnvironmentGeneration: 1,
      snapshotFingerprint: "a".repeat(64),
      status: "pending",
      message: null,
      createdAt: current.deployment.createdAt,
      finishedAt: null,
      targetKind: "forum",
      nativeReceipts: [{ action: "original", receipt: originalReceipt }],
    },
    deployment: current,
    priorDeployment: null,
    expectedSettlements: { desired: "a".repeat(64) },
    recoveryHistory: [],
  });
  const originalEntry = context.intent.nativeReceipts[0];
  if (originalEntry === undefined) throw new Error("Expected original receipt");
  vi.mocked(forumJobs.originalForumRecoveryJob).mockResolvedValue({
    original,
    receipt: originalEntry.receipt,
  });
  const jobs = new Map<string, V1Job>([[original.metadata.name, original]]);
  const pods = new Map<string, ReturnType<typeof releasePod>>([
    [
      original.metadata.name,
      releasePod(original, scenario === "ran" ? "ran" : "never-started"),
    ],
  ]);
  if (scenario === "repair" || scenario === "other-error") {
    const repair = forumJobs.forumRecoveryChild({
      original,
      receipt: originalEntry.receipt,
      intentId,
      action: "repair",
      attempt: 1,
    });
    const metadata = repair.metadata;
    if (metadata?.name === undefined)
      throw new Error("Expected named deterministic repair");
    const { name } = metadata;
    const uid = crypto.randomUUID();
    metadata.uid = uid;
    repair.status = original.status;
    context.intent.nativeReceipts.push({
      action: "repair",
      receipt: {
        namespace,
        name,
        uid,
        specFingerprint: forumJobs.forumJobFingerprint(repair),
        requestId: "forum/repair",
      },
    });
    jobs.set(name, repair);
    pods.set(name, releasePod(repair, "repair"));
  }
  const kube = useKubernetesFixture((request) => {
    const url = new URL(request.url);
    const response = additionalResponse?.(url);
    if (response !== undefined) return response;
    if (url.pathname.endsWith("/log")) {
      return new Response(
        url.searchParams.get("container") === "release"
          ? scenario === "other-error"
            ? "error: migration started then failed"
            : `${missingJournal}\n`
          : `S3Error:\npath: "${bundlePath}",\ncode: "ConnectionRefused",`,
      );
    }
    if (url.pathname.endsWith("/pods")) {
      const selector = url.searchParams.get("labelSelector");
      const items =
        selector?.startsWith("job-name=") === true
          ? [pods.get(selector.slice(9))]
          : [...pods.values()];
      return Response.json({ items });
    }
    const job = jobs.get(url.pathname.split("/").at(-1) ?? "");
    return job === undefined
      ? new Response(null, { status: 404 })
      : Response.json(job);
  });
  return { context, ...kube };
}

test.each([
  { scenario: "original", failed: false, expected: undefined },
  {
    scenario: "repair",
    failed: false,
    expected: { metadata: { name: "repair-pod" } },
  },
  {
    scenario: "ran",
    failed: true,
    expected: "may have entered its migration process",
  },
  {
    scenario: "other-error",
    failed: true,
    expected: "does not prove the missing-journal guard",
  },
] as const)(
  "requires exact terminal native evidence for $scenario",
  async ({ scenario, failed, expected }) => {
    const { context, config, stop } = receiptsFixture(scenario);
    try {
      const checked = requireForumPreMigration(
        context,
        { namespace, image, bundle },
        config,
        async () => {
          throw new Error(
            "Unexpected command outside original Job verification",
          );
        },
      );
      if (failed) await expect(checked).rejects.toThrow(expected);
      else if (expected === undefined)
        await expect(checked).resolves.toBeUndefined();
      else await expect(checked).resolves.toMatchObject(expected);
    } finally {
      await stop();
    }
  },
);

const priorImage = {
  ...image,
  digest: digest("d"),
  sourceRevision: "d".repeat(40),
};
const priorReference = `${priorImage.uri}@${priorImage.digest}`;

function priorKubernetesResource(url: URL, replaced: boolean) {
  const name = url.pathname.split("/").at(-1);
  if (name === "readyz") return new Response("Forum ready");
  if (name === "storm-forum-web")
    return Response.json({
      metadata: { uid: "web" },
      spec: { replicas: 1 },
      status: { readyReplicas: 1 },
    });
  if (name === "storm-forum-database" && url.pathname.includes("/deployments/"))
    return Response.json({
      metadata: { uid: "database" },
      spec: {
        template: {
          spec: {
            volumes: [
              {
                name: "database",
                persistentVolumeClaim: { claimName: "storm-forum-database" },
              },
            ],
          },
        },
      },
    });
  if (name === "forum-replica")
    return Response.json({
      metadata: {
        uid: "replica",
        ownerReferences: [{ kind: "Deployment", uid: "web", controller: true }],
      },
    });
  if (url.pathname.includes("/persistentvolumeclaims/"))
    return Response.json({
      metadata: {
        name,
        uid: `claim/${name ?? "unknown"}`,
        resourceVersion: "1",
      },
      spec: { volumeName: `pv/${name ?? "unknown"}` },
      status: { phase: "Bound" },
    });
  if (url.searchParams.get("labelSelector") === "app=storm-forum,component=web")
    return Response.json({
      items: [
        {
          metadata: {
            uid: replaced ? "replacement" : "php-pod",
            name: "storm-forum-web-fixture",
            resourceVersion: "1",
            ownerReferences: [
              {
                kind: "ReplicaSet",
                name: "forum-replica",
                uid: "replica",
                controller: true,
              },
            ],
          },
          spec: {
            nodeName: "prior-node",
            containers: [{ name: "php", image: priorReference }],
            volumes: [
              {
                name: "files",
                persistentVolumeClaim: { claimName: "storm-forum-files" },
              },
            ],
          },
          status: {
            phase: "Running",
            conditions: [{ type: "Ready", status: "True" }],
            containerStatuses: [
              {
                name: "php",
                image: priorReference,
                imageID: priorReference,
                ready: true,
                state: { running: {} },
              },
            ],
          },
        },
      ],
    });
  return;
}

function priorAcceptance(origin: string) {
  const prior = forumDeployment(
    {
      ...forumRecipe,
      oracle: {
        probes: [{ url: `${origin}/readyz`, expectedStatus: 200 }],
        tests: [],
      },
    },
    [{ key: "step-forum-bundle", status: "running" }],
  );
  prior.deployment.id = "deployment/accepted-forum";
  prior.deployment.status = "succeeded";
  prior.environment.id = prior.deployment.environmentId;
  prior.versionSet.id = "version/accepted-forum";
  prior.versionSet.components["image:storm-forum"] = priorImage;
  const recipe = stepRecipeOf(prior.pipeline.definition, "forum-bundle");
  const stage = prior.stages[0];
  if (recipe === null || stage === undefined)
    throw new Error("Prior acceptance fixture lacks its native stage");
  stage.status = "succeeded";
  const rendered = renderApplication(prior, recipe);
  const operation = crypto.randomUUID();
  const record = {
    kind: "reconciliation" as const,
    deploymentId: prior.deployment.id,
    createdAt: prior.deployment.createdAt,
  };
  prior.evidence = [
    {
      ...record,
      id: "bundle-proof",
      operationId: stage.operationId,
      summary: `Owned operation ${operation} binds licensed bundle ${bundleDigest} (XenForo ${bundleVersion}) at ${rendered.revision}; release Job ${namespace}/storm-forum-release-${forumReleaseId(prior.deployment.id)} completed`,
    },
    {
      ...record,
      id: "operation-proof",
      operationId: operation,
      summary: "Owned operation finished with the exact source",
    },
  ];
  return { prior, recipe, rendered };
}

function currentArgo(
  failed: DeploymentDetail,
  selection: ReturnType<typeof priorAcceptance>,
) {
  const rendered = renderApplication(failed, selection.recipe);
  return {
    metadata: {
      name: namespace,
      uid: "app",
      annotations: { [DELIVERY_ENVIRONMENT_ANNOTATION]: failed.environment.id },
    },
    spec: { source: rendered.source },
    status: {
      history: [
        {
          id: 47,
          revision: selection.rendered.revision,
          source: selection.rendered.source,
        },
      ],
      operationState: {
        phase: "Failed",
        operation: {
          info: [
            {
              name: "ci.sjer.red/request-id",
              value: deliveryOperationId(failed.deployment.id),
            },
            { name: "ci.sjer.red/operation-id", value: crypto.randomUUID() },
          ],
        },
        syncResult: {
          revision: rendered.revision,
          resources: [
            {
              kind: "Job",
              namespace,
              name: `storm-forum-release-${forumReleaseId(failed.deployment.id)}`,
              hookPhase: "Failed",
            },
          ],
        },
      },
    },
  };
}

test.each([
  { scenario: "exact prior", changed: false },
  { scenario: "replacement during probe", changed: true },
])(
  "independently inspects Forum Argo, prior workload, PVCs, PHP and HTTP for $scenario",
  async ({ changed }) => {
    let nativeReads = 0;
    const { context, config, origin, stop } = receiptsFixture(
      "original",
      (url) => priorKubernetesResource(url, changed && nativeReads === 1),
    );
    try {
      const selection = priorAcceptance(origin);
      const { prior } = selection;
      const { deployment: failed, intent } = context;
      failed.deployment.status = "failed";
      failed.deployment.recoveryRequired = true;
      failed.environment.id = failed.deployment.environmentId;
      failed.environment.acceptedDeploymentId = prior.deployment.id;
      failed.environment.acceptedVersionSetRevisionId = prior.versionSet.id;
      intent.dispatchBarrier = {
        adapter: "control-plane-dispatch-barrier/v1",
        deploymentUID: "producer",
        priorReplicas: 1,
        templateFingerprint: "a".repeat(64),
        podUIDs: ["producer-pod"],
        replicaSetUIDs: ["producer-rs"],
      };
      context.priorDeployment = prior;
      vi.mocked(argoApplicationRequest).mockResolvedValue(
        currentArgo(failed, selection),
      );
      const checked = inspectForumPrior(
        context,
        prior,
        config,
        async (argv) => {
          expect(argv).toEqual([
            "kubectl",
            "--context",
            "fixture",
            "--request-timeout=15s",
            "--namespace",
            namespace,
            "exec",
            "storm-forum-web-fixture",
            "--container",
            forumNativeObservation.container,
            "--",
            ...forumNativeObservation.command,
          ]);
          nativeReads++;
          return {
            stdout: JSON.stringify({
              schemaVersion: 1,
              state: "installed",
              xenforoVersion: bundleVersion,
              bundleSha256: bundleHash,
              maintenance: false,
              releaseLock: false,
            }),
            stderr: "",
          };
        },
      );
      if (changed)
        await expect(checked).rejects.toThrow("changed during fixed readback");
      else
        await expect(checked).resolves.toEqual({
          observedAt: expect.any(String),
        });
      expect(nativeReads).toBe(changed ? 1 : 2);
    } finally {
      await stop();
    }
  },
);

function configuration(artifact: ArtifactVersion, lastLayer: string) {
  return {
    os: "linux",
    architecture: "amd64",
    config: {
      Env: [`GIT_SHA=${artifact.sourceRevision}`],
      Labels: { [FORUM_RECOVERY_IMAGE_LABEL]: FORUM_RECOVERY_IMAGE_ABI },
    },
    rootfs: {
      type: "layers",
      diff_ids: [artifact.digest, digest("a"), lastLayer],
    },
    history: [
      { created_by: "earlier filesystem layer" },
      { created_by: "COPY packages/storm-forum /opt/storm-forum # buildkit" },
      { created_by: "configuration only", empty_layer: true },
      { created_by: "later filesystem layer" },
    ],
  };
}

test.each([
  {
    scenario: "matching",
    repairedArch: "amd64",
    priorLayer: "b",
    error: undefined,
  },
  {
    scenario: "later layer changed",
    repairedArch: "amd64",
    priorLayer: "d",
    error: "different packaged history",
  },
  {
    scenario: "mismatched nodes",
    repairedArch: "arm64",
    priorLayer: "b",
    error: "different native architectures",
  },
])(
  "compares the full packaged layer suffix on actual nodes ($scenario)",
  async ({ repairedArch, priorLayer, error }) => {
    const { config, stop } = useKubernetesFixture((request) =>
      Response.json({
        status: {
          nodeInfo: {
            operatingSystem: "linux",
            architecture: request.url.endsWith("/repair-node")
              ? repairedArch
              : "amd64",
          },
        },
      }),
    );
    const pod: V1Pod = { spec: { nodeName: "repair-node", containers: [] } };
    try {
      const checked = requireSameForumAssemblyLayers(
        config,
        { pod, image },
        { node: "prior-node", image: priorImage },
        async (argv) => {
          const inspectedPrior = argv.includes(priorReference);
          const inspected = inspectedPrior ? priorImage : image;
          return {
            stdout: JSON.stringify(
              configuration(
                inspected,
                digest(inspectedPrior ? priorLayer : "b"),
              ),
            ),
            stderr: "",
          };
        },
      );
      if (error === undefined) await expect(checked).resolves.toBeUndefined();
      else await expect(checked).rejects.toThrow(error);
    } finally {
      await stop();
    }
  },
);
