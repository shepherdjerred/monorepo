import {
  CoreV1Api,
  type KubeConfig,
  type V1Container,
  type V1ContainerStatus,
  type V1Pod,
} from "@kubernetes/client-node";
import type {
  ArtifactVersion,
  ContentRecoveryContext,
  ContentRecoveryNativeReceipt,
} from "@shepherdjerred/delivery/contract";
import { forumNativeObservation as observer } from "@shepherdjerred/ops-model/forum/native-observation.ts";
import { ociImageConfigurations } from "@shepherdjerred/ops-model/oci-image-configurations.ts";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { z } from "zod";
import {
  assertNoOtherForumWriter,
  forumImageProvesRelease,
  forumRecoveryChild,
  forumJobFingerprint,
  originalForumRecoveryJob,
} from "#lib/delivery/content-recovery/forum-jobs.ts";
import {
  contentNativeReader,
  proveContentNativeJobs,
} from "#lib/delivery/content-recovery/native-proof.ts";
import type { RolloutCommandRunner } from "#lib/worker-deployment-proofs.ts";

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const Namespace = z.enum(observer.namespaces);
const MissingJournal =
  "Legacy Forum release has no native phase journal; inspect its retained original Job and use reviewed native repair, never remove markers or retry a migration blindly";
type Receipt = ContentRecoveryNativeReceipt["receipt"];
type ForumNativeRelease = {
  namespace: z.infer<typeof Namespace>;
  image: ArtifactVersion;
  bundle: ArtifactVersion;
};

export function forumRuntimeImageMatches(
  status: V1ContainerStatus | undefined,
  image: ArtifactVersion,
) {
  return [image.digest, ...image.runtimeDigests].some(
    (digest) => status?.imageID === `${image.uri}@${digest}`,
  );
}

function requireReviewedCommand(item: V1Container, image: ArtifactVersion) {
  if (
    item.image !== `${image.uri}@${image.digest}` ||
    canonicalJson(item.command) !==
      canonicalJson(["bun", "/opt/storm-forum/src/cli.ts", item.name]) ||
    (item.args?.length ?? 0) !== 0
  )
    throw new Error(
      "Forum Job process does not match the reviewed immutable command",
    );
}

function reviewedContainer(
  pod: V1Pod,
  container: "assemble" | "release",
  image: ArtifactVersion,
) {
  const assembling = container === "assemble";
  if (pod.spec === undefined || pod.status === undefined)
    throw new Error(
      "Forum Job Pod does not retain its specification and status",
    );
  const containers = assembling ? pod.spec.initContainers : pod.spec.containers;
  const statuses = assembling
    ? pod.status.initContainerStatuses
    : pod.status.containerStatuses;
  const item = containers?.[0];
  const status = statuses?.[0];
  if (
    containers?.length !== 1 ||
    statuses?.length !== 1 ||
    item?.name !== container ||
    status?.name !== container ||
    status.restartCount !== 0 ||
    status.lastState?.terminated !== undefined
  )
    throw new Error(
      "Forum Job does not have its reviewed single assembly and release process",
    );
  requireReviewedCommand(item, image);
  return status;
}

async function requireFailedPod(
  read: ReturnType<typeof contentNativeReader>,
  receipt: Receipt,
) {
  const pods = await read.pods(receipt.namespace, receipt.name);
  const pod = pods[0];
  if (
    pods.length !== 1 ||
    pod?.status?.phase !== "Failed" ||
    pod.metadata?.ownerReferences?.filter((owner) => owner.controller === true)
      .length !== 1 ||
    !pod.metadata.ownerReferences.some(
      (owner) =>
        owner.controller === true &&
        owner.kind === "Job" &&
        owner.uid === receipt.uid,
    )
  )
    throw new Error(
      "Forum receipt lacks its unique, retained terminal native Pod",
    );
  return pod;
}

async function logs(core: CoreV1Api, pod: V1Pod, container: string) {
  const result = await core.readNamespacedPodLog({
    namespace: Namespace.parse(pod.metadata?.namespace),
    name: z.string().min(1).parse(pod.metadata?.name),
    container,
    limitBytes: 4096,
  });
  if (Buffer.byteLength(result) > 4096)
    throw new Error("Forum native failure log exceeds its bound");
  return result;
}

async function requireOriginalNeverStarted(
  core: CoreV1Api,
  initial: V1Pod,
  current: ForumNativeRelease,
) {
  const assembled = reviewedContainer(initial, "assemble", current.image);
  const release = reviewedContainer(initial, "release", current.image);
  if (
    assembled.state?.terminated?.exitCode !== 1 ||
    !forumRuntimeImageMatches(assembled, current.image) ||
    release.state?.waiting?.reason !== "PodInitializing" ||
    release.started === true ||
    (release.containerID ?? "") !== "" ||
    release.state.running !== undefined ||
    release.state.terminated !== undefined
  )
    throw new Error(
      "Original Forum release may have entered its migration process",
    );
  const initialLog = await logs(core, initial, "assemble");
  if (
    !initialLog.includes("S3Error:") ||
    !initialLog.includes('code: "ConnectionRefused"') ||
    !initialLog.includes(
      `path: "releases/${current.bundle.digest.slice(7)}.zip"`,
    )
  )
    throw new Error(
      "Original Forum assembly does not prove a pre-unpack archive connection refusal",
    );
}

async function requireNoForumWriters(
  core: CoreV1Api,
  current: ForumNativeRelease,
) {
  const writers = await core.listNamespacedPod({
    namespace: current.namespace,
    labelSelector: "app=storm-forum,component=release",
    limit: 1000,
  });
  if ((writers.metadata?._continue ?? "") !== "")
    throw new Error("Forum writer history exceeds its inspection bound");
  assertNoOtherForumWriter(writers.items, "");
}

async function requireRepairSpec(input: {
  read: ReturnType<typeof contentNativeReader>;
  checked: Awaited<ReturnType<typeof originalForumRecoveryJob>>;
  intentId: string;
  receipt: Receipt;
}) {
  const { read, checked, intentId, receipt } = input;
  const child = forumRecoveryChild({
    ...checked,
    intentId,
    action: "repair",
    attempt: 1,
  });
  const actual = await read.job(receipt.namespace, receipt.name);
  if (
    child.metadata?.name !== receipt.name ||
    child.metadata.namespace !== receipt.namespace ||
    canonicalJson(child.metadata.annotations) !==
      canonicalJson(actual.metadata?.annotations) ||
    forumJobFingerprint(child) !== receipt.specFingerprint
  )
    throw new Error(
      "Forum repair did not run the exact original with the plain recovery ABI",
    );
}

async function requireRepairMissingJournal(
  core: CoreV1Api,
  repaired: V1Pod,
  current: ForumNativeRelease,
) {
  const init = reviewedContainer(repaired, "assemble", current.image);
  const repairRelease = reviewedContainer(repaired, "release", current.image);
  const releaseLog = await logs(core, repaired, "release");
  if (
    init.state?.terminated?.exitCode !== 0 ||
    !forumRuntimeImageMatches(init, current.image) ||
    repairRelease.state?.terminated?.exitCode !== 1 ||
    !forumRuntimeImageMatches(repairRelease, current.image) ||
    !releaseLog.split("\n").includes(`error: ${MissingJournal}`)
  )
    throw new Error(
      "Forum repair does not prove the missing-journal guard before mutation",
    );
}

export async function requireForumPreMigration(
  context: ContentRecoveryContext,
  current: ForumNativeRelease,
  config: KubeConfig,
  command: RolloutCommandRunner,
): Promise<V1Pod | undefined> {
  const read = contentNativeReader(config);
  const core = config.makeApiClient(CoreV1Api);
  const historical = context.recoveryHistory.filter(
    ({ id }) => id !== context.intent.id,
  );
  const receipts = context.intent.nativeReceipts;
  const [original, repair] = receipts;
  if (
    original?.action !== "original" ||
    receipts.length > 2 ||
    (repair !== undefined && repair.action !== "repair") ||
    historical.some(({ nativeReceipts }) => nativeReceipts.length > 0)
  )
    throw new Error(
      "Forum prior recovery requires an unambiguous original and at most one unacknowledged repair",
    );
  const checked = await originalForumRecoveryJob(context, config, command);
  if (canonicalJson(checked.receipt) !== canonicalJson(original.receipt))
    throw new Error(
      "Forum original writer differs from its immutable native receipt",
    );
  const terminal = await proveContentNativeJobs(context, read);
  if (
    terminal.length !== receipts.length ||
    terminal.some(({ status, podsAbsent }) => status !== "Failed" || podsAbsent)
  )
    throw new Error(
      "Forum release and repair must both retain exact failed native Pods",
    );
  const initial = await requireFailedPod(read, original.receipt);
  await requireOriginalNeverStarted(core, initial, current);
  await requireNoForumWriters(core, current);
  if (repair === undefined) return undefined;
  await requireRepairSpec({
    read,
    checked,
    intentId: context.intent.id,
    receipt: repair.receipt,
  });
  const repaired = await requireFailedPod(read, repair.receipt);
  await requireRepairMissingJournal(core, repaired, current);
  return repaired;
}

const LayerConfiguration = z.object({
  os: z.literal("linux"),
  architecture: z.string(),
  rootfs: z.object({ type: z.literal("layers"), diff_ids: z.array(Digest) }),
  history: z.array(
    z.object({ created_by: z.string(), empty_layer: z.boolean().optional() }),
  ),
});

function assemblyLayers(raw: unknown, architecture: string) {
  const single = LayerConfiguration.safeParse(raw);
  const configurations = single.success
    ? [single.data]
    : Object.values(z.record(z.string(), LayerConfiguration).parse(raw));
  const matches = configurations.filter(
    (image) => image.architecture === architecture,
  );
  const image = matches[0];
  if (image === undefined || matches.length !== 1)
    throw new Error(
      "Forum image has no unique configuration for the native architecture",
    );
  const layers = image.history.filter((layer) => layer.empty_layer !== true);
  const path =
    /^COPY packages\/storm-forum \/opt\/storm-forum(?: # buildkit)?$/u;
  const indices = layers.flatMap((layer, index) =>
    path.test(layer.created_by) ? [index] : [],
  );
  const index = indices[0];
  if (
    index === undefined ||
    indices.length !== 1 ||
    layers.length !== image.rootfs.diff_ids.length
  )
    throw new Error(
      "Forum image lacks its uniquely paired packaged history layer",
    );
  // A later filesystem layer could overwrite the packaged history.
  return image.rootfs.diff_ids.slice(index);
}

export async function requireSameForumAssemblyLayers(
  config: KubeConfig,
  repaired: { pod: V1Pod; image: ArtifactVersion },
  serving: { node: string; image: ArtifactVersion },
  command: RolloutCommandRunner,
) {
  const core = config.makeApiClient(CoreV1Api);
  const node = async (name: string) =>
    z
      .object({
        status: z.object({
          nodeInfo: z.object({
            operatingSystem: z.literal("linux"),
            architecture: z.string().min(1),
          }),
        }),
      })
      .parse(await core.readNode({ name })).status.nodeInfo.architecture;
  const architectures = await Promise.all([
    node(z.string().min(1).parse(repaired.pod.spec?.nodeName)),
    node(serving.node),
  ]);
  const [architecture, priorArchitecture] = architectures;
  if (architecture !== priorArchitecture)
    throw new Error(
      "Forum repair and accepted web Pod ran on different native architectures",
    );
  const layers = await Promise.all(
    [repaired.image, serving.image].map(async (image) => {
      const inspected = await command([
        "docker",
        "buildx",
        "imagetools",
        "inspect",
        `${image.uri}@${image.digest}`,
        "--format",
        "{{json .Image}}",
      ]);
      const raw: unknown = JSON.parse(inspected.stdout);
      if (
        !forumImageProvesRelease(
          ociImageConfigurations(raw),
          image.sourceRevision,
        )
      )
        throw new Error(
          "Forum assembly image lacks its source identity or reviewed ABI",
        );
      return assemblyLayers(raw, architecture);
    }),
  );
  if (canonicalJson(layers[0]) !== canonicalJson(layers[1]))
    throw new Error(
      "Forum successful repair init may have copied different packaged history",
    );
}
