import {
  AppsV1Api,
  CoreV1Api,
  type KubeConfig,
  type V1Deployment,
  type V1Pod,
} from "@kubernetes/client-node";
import {
  ForumRuntimeStatusSchema,
  type ContentRecoveryContext,
  type DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import {
  forumReleaseOf,
  stepRecipeOf,
} from "@shepherdjerred/delivery/model-contract";
import { forumNativeObservation as observer } from "@shepherdjerred/ops-model/forum/native-observation.ts";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { z } from "zod";
import { argoApplicationRequest } from "#lib/delivery/argo-client.ts";
import { forumReleaseId } from "#lib/delivery/forum.ts";
import { renderApplication } from "#lib/delivery/model/application.ts";
import { requireRenderedSource } from "#lib/delivery/model/application-proof.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import type { RolloutCommandRunner } from "#lib/worker-deployment-proofs.ts";
import {
  forumRuntimeImageMatches,
  requireForumPreMigration,
  requireSameForumAssemblyLayers,
} from "./content-delivery-recovery-forum-prior-native.ts";

const Namespace = z.enum(observer.namespaces);
const CanonicalRuntime = "docker.io/shepherdjerred/storm-forum";

function frozenForum(detail: DeploymentDetail) {
  const definition = detail.pipeline.definition;
  const recipe = stepRecipeOf(definition, "forum-bundle");
  const forum = forumReleaseOf(definition);
  if (
    forum === undefined ||
    recipe === null ||
    definition.kind !== "kubernetes-application"
  )
    throw new Error(
      "Prior Forum recovery requires a standalone model Forum Application",
    );
  const namespace = Namespace.parse(recipe.application.destination.namespace);
  const image = detail.versionSet.components[forum.imageComponent];
  const bundle = detail.versionSet.components[forum.bundleComponent];
  if (
    recipe.application.name !== namespace ||
    image?.kind !== "image" ||
    image.uri !== CanonicalRuntime ||
    bundle?.kind !== "archive" ||
    bundle.origin.kind !== "licensed-bundle"
  )
    throw new Error(
      "Forum selection lacks canonical native release provenance",
    );
  return {
    namespace,
    image,
    bundle,
    job: `storm-forum-release-${forumReleaseId(detail.deployment.id)}`,
    application: renderApplication(detail, recipe),
    probes: recipe.oracle.probes,
  };
}

type FrozenForum = ReturnType<typeof frozenForum>;
const ArgoHistory = z.object({
  metadata: z.object({ uid: z.string().min(1) }),
  operation: z.null().optional(),
  status: z.object({
    history: z.array(
      z.object({ id: z.int(), revision: z.string(), source: z.json() }),
    ),
    operationState: z.object({
      phase: z.literal("Failed"),
      operation: z.object({
        info: z.array(z.object({ name: z.string(), value: z.string() })),
      }),
      syncResult: z.object({
        revision: z.string(),
        resources: z.array(
          z.object({
            kind: z.string(),
            namespace: z.string().optional(),
            name: z.string(),
            hookPhase: z.string().optional(),
          }),
        ),
      }),
    }),
  }),
});

async function verifyArgo(
  current: FrozenForum,
  prior: FrozenForum,
  deploymentId: string,
) {
  const raw = await argoApplicationRequest(current.namespace);
  requireRenderedSource(raw, current.application);
  const observed = ArgoHistory.parse(raw);
  const state = observed.status.operationState;
  const requests = state.operation.info.filter(
    ({ name }) => name === "ci.sjer.red/request-id",
  );
  const operations = state.operation.info.filter(
    ({ name }) => name === "ci.sjer.red/operation-id",
  );
  const last = observed.status.history.at(-1);
  if (
    requests.length !== 1 ||
    requests[0]?.value !== deliveryOperationId(deploymentId) ||
    operations.length !== 1 ||
    state.syncResult.revision !== current.application.revision ||
    !state.syncResult.resources.some(
      (resource) =>
        resource.kind === "Job" &&
        resource.namespace === current.namespace &&
        resource.name === current.job &&
        resource.hookPhase === "Failed",
    ) ||
    last?.revision !== prior.application.revision ||
    canonicalJson(last.source) !== canonicalJson(prior.application.source)
  )
    throw new Error(
      "Forum Argo history differs from the exact failed and previously accepted releases",
    );
  return {
    uid: observed.metadata.uid,
    priorHistoryId: last.id,
    operation: z.uuid().parse(operations[0]?.value),
  };
}

function requireAcceptedReceipt(detail: DeploymentDetail, prior: FrozenForum) {
  const stage = detail.stages.find(({ key }) => key === "step-forum-bundle");
  const suffix = ` binds licensed bundle ${prior.bundle.digest} (XenForo ${prior.bundle.version}) at ${prior.application.revision}; release Job ${prior.namespace}/${prior.job} completed`;
  const proofs = detail.evidence.filter(
    ({ kind, operationId, summary }) =>
      kind === "reconciliation" &&
      operationId === stage?.operationId &&
      summary.startsWith("Owned operation ") &&
      summary.endsWith(suffix),
  );
  const operation = z
    .uuid()
    .safeParse(
      proofs[0]?.summary.slice("Owned operation ".length, -suffix.length),
    );
  if (
    stage?.status !== "succeeded" ||
    proofs.length !== 1 ||
    !operation.success ||
    !detail.evidence.some(
      (proof) =>
        proof.kind === "reconciliation" && proof.operationId === operation.data,
    )
  )
    throw new Error(
      "Prior Forum selection lacks its accepted native Job and operation evidence",
    );
}

function requireServingForumPod(pod: V1Pod | undefined, prior: FrozenForum) {
  if (
    pod?.metadata === undefined ||
    pod.spec === undefined ||
    pod.status === undefined
  )
    throw new Error(
      "Previously accepted Forum Pod does not retain its identity and status",
    );
  const php = pod.status.containerStatuses?.find(
    ({ name }) => name === observer.container,
  );
  if (
    pod.metadata.name?.startsWith(observer.podPrefix) !== true ||
    pod.metadata.deletionTimestamp !== undefined ||
    pod.spec.volumes?.some(
      (volume) =>
        volume.persistentVolumeClaim?.claimName === "storm-forum-files",
    ) !== true ||
    !pod.spec.containers.some(
      (container) =>
        container.name === observer.container &&
        container.image === `${prior.image.uri}@${prior.image.digest}`,
    ) ||
    pod.status.phase !== "Running" ||
    php?.ready !== true ||
    php.state?.running === undefined ||
    pod.status.conditions?.some(
      ({ type, status }) => type === "Ready" && status === "True",
    ) !== true ||
    !forumRuntimeImageMatches(php, prior.image)
  )
    throw new Error(
      "Previously accepted Forum runtime is not Ready on its original files claim",
    );
  return { metadata: pod.metadata, spec: pod.spec };
}

async function readForumClaims(
  core: CoreV1Api,
  namespace: FrozenForum["namespace"],
) {
  return await Promise.all(
    observer.claims.map(async (name) => {
      const claim = await core.readNamespacedPersistentVolumeClaim({
        namespace,
        name,
      });
      if (claim.metadata?.name !== name || claim.status?.phase !== "Bound")
        throw new Error("Forum original storage is not bound");
      return {
        name,
        uid: z.string().min(1).parse(claim.metadata.uid),
        volume: z.string().min(1).parse(claim.spec?.volumeName),
        resourceVersion: z
          .string()
          .min(1)
          .parse(claim.metadata.resourceVersion),
      };
    }),
  );
}

function usesOriginalForumDatabase(database: V1Deployment) {
  return (
    database.spec?.template.spec?.volumes?.some(
      (volume) =>
        volume.name === "database" &&
        volume.persistentVolumeClaim?.claimName === "storm-forum-database",
    ) === true
  );
}

async function readServingForum(config: KubeConfig, prior: FrozenForum) {
  const namespace = prior.namespace;
  const core = config.makeApiClient(CoreV1Api),
    apps = config.makeApiClient(AppsV1Api);
  const [web, database, listed, storage] = await Promise.all([
    apps.readNamespacedDeployment({ namespace, name: "storm-forum-web" }),
    apps.readNamespacedDeployment({ namespace, name: "storm-forum-database" }),
    core.listNamespacedPod({
      namespace,
      labelSelector: "app=storm-forum,component=web",
      limit: 2,
    }),
    readForumClaims(core, namespace),
  ]);
  if (
    listed.items.length !== 1 ||
    (listed.metadata?._continue ?? "") !== "" ||
    web.spec?.replicas !== 1 ||
    web.status?.readyReplicas !== 1 ||
    !usesOriginalForumDatabase(database)
  )
    throw new Error(
      "Previously accepted Forum runtime is not the sole Ready prior Pod on its original claims",
    );
  const pod = requireServingForumPod(listed.items[0], prior);
  const parent = pod.metadata.ownerReferences?.find(
    ({ controller, kind }) => controller === true && kind === "ReplicaSet",
  );
  const replica = await apps.readNamespacedReplicaSet({
    namespace,
    name: z.string().min(1).parse(parent?.name),
  });
  const webUid = z.string().min(1).parse(web.metadata?.uid);
  const replicaUid = z.string().min(1).parse(replica.metadata?.uid);
  if (
    replicaUid !== parent?.uid ||
    replica.metadata?.ownerReferences?.some(
      ({ controller, kind, uid }) =>
        controller === true && kind === "Deployment" && uid === webUid,
    ) !== true
  )
    throw new Error(
      "Previously accepted Forum Pod is not owned by the exact web Deployment",
    );
  return {
    pod: z.string().min(1).parse(pod.metadata.name),
    uid: z.string().min(1).parse(pod.metadata.uid),
    resourceVersion: z.string().min(1).parse(pod.metadata.resourceVersion),
    node: z.string().min(1).parse(pod.spec.nodeName),
    replica: replicaUid,
    web: webUid,
    database: z.string().min(1).parse(database.metadata?.uid),
    storage,
  };
}

function requirePriorSelection(
  context: ContentRecoveryContext,
  prior: DeploymentDetail,
) {
  const failed = context.deployment;
  const current = frozenForum(failed),
    accepted = frozenForum(prior);
  if (
    context.intent.targetKind !== "forum" ||
    context.intent.status !== "pending" ||
    context.intent.dispatchBarrier === null ||
    context.intent.barrierRestoredAt !== null ||
    failed.deployment.status !== "failed" ||
    !failed.deployment.recoveryRequired ||
    failed.environment.activeDeploymentId !== failed.deployment.id ||
    failed.environment.generation !==
      context.intent.expectedEnvironmentGeneration ||
    canonicalJson(context.priorDeployment) !== canonicalJson(prior) ||
    failed.environment.acceptedDeploymentId !== prior.deployment.id ||
    failed.environment.acceptedVersionSetRevisionId !== prior.versionSet.id ||
    prior.deployment.status !== "succeeded" ||
    failed.environment.id !== prior.environment.id ||
    current.namespace !== accepted.namespace ||
    current.bundle.digest !== accepted.bundle.digest ||
    current.bundle.version !== accepted.bundle.version
  )
    throw new Error(
      "Forum prior recovery lacks the same licensed archive and genuine prior acceptance",
    );
  requireAcceptedReceipt(prior, accepted);
  return { failed, current, accepted };
}

/** Proves a Forum failure before migration with the accepted prior still serving. */
export async function inspectForumPrior(
  context: ContentRecoveryContext,
  prior: DeploymentDetail,
  config: KubeConfig,
  command: RolloutCommandRunner,
): Promise<{ observedAt: string }> {
  const { failed, current, accepted } = requirePriorSelection(context, prior);
  const repaired = await requireForumPreMigration(
    context,
    current,
    config,
    command,
  );
  const [argo, web] = await Promise.all([
    verifyArgo(current, accepted, failed.deployment.id),
    readServingForum(config, accepted),
  ]);
  if (repaired !== undefined)
    await requireSameForumAssemblyLayers(
      config,
      { pod: repaired, image: current.image },
      { node: web.node, image: accepted.image },
      command,
    );
  for (let observation = 0; observation < 2; observation++) {
    const result = await command([
      "kubectl",
      "--context",
      config.getCurrentContext(),
      "--request-timeout=15s",
      "--namespace",
      accepted.namespace,
      "exec",
      web.pod,
      "--container",
      observer.container,
      "--",
      ...observer.command,
    ]);
    if (Buffer.byteLength(result.stdout) > 16 * 1024)
      throw new Error("Forum fixed native read exceeded its output bound");
    const observed = ForumRuntimeStatusSchema.parse(JSON.parse(result.stdout));
    if (
      observed.xenforoVersion !== accepted.bundle.version ||
      observed.bundleSha256 !== accepted.bundle.digest.slice(7) ||
      canonicalJson(await readServingForum(config, accepted)) !==
        canonicalJson(web)
    )
      throw new Error(
        "Forum prior runtime or native storage changed during fixed readback",
      );
  }
  if (
    canonicalJson(await verifyArgo(current, accepted, failed.deployment.id)) !==
    canonicalJson(argo)
  )
    throw new Error(
      "Forum Argo operation or prior history changed during native readback",
    );
  const probe = accepted.probes[0];
  if (accepted.probes.length !== 1 || probe?.expectedStatus !== 200)
    throw new Error(
      "Accepting the prior Forum requires its reviewed public probe",
    );
  const response = await fetch(probe.url, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 200)
    throw new Error(
      "Previously accepted public Forum probe did not return HTTP 200",
    );
  await response.body?.cancel();
  return { observedAt: new Date().toISOString() };
}
