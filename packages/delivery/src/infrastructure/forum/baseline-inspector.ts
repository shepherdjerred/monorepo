import {
  forumReleaseOf,
  stepApplicationOf,
} from "#shared/model/recipe-view.ts";
import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";
import type { ForumBaselineContext } from "#shared/contract.ts";
import {
  ForumBaselineProofSchema,
  ForumRuntimeStatusSchema,
} from "#shared/forum-contract.ts";
import type { InspectForumBaseline } from "./baseline-settlement.ts";
import { Application, Metadata, Tree, nativeJob, nativePod } from "./native.ts";
import { requireBundlePolicy } from "./source-policy.ts";
import type { ForumPolicyReader } from "./source-policy.ts";
import { createOriginalForumPolicyReader } from "./legacy-policy.ts";
import type { OriginalForumPolicy } from "./legacy-policy.ts";
import { createNativeForumReader } from "./native-reader.ts";
import type { NativeForumReader } from "./native-reader.ts";
import { observeForumStorage, requireOriginalDatabase } from "./storage.ts";

type Transport = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
type Options = {
  argoOrigin: string;
  argoToken: string | undefined;
  observationToken: string | undefined;
  fetch?: Transport;
  policyReader?: ForumPolicyReader;
  nativeReader?: NativeForumReader;
  originalPolicyReader?: (revision: string) => Promise<OriginalForumPolicy>;
};
function privatePodOrigin(ip: string) {
  if (!/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(ip))
    throw new DeliveryError(
      "CONFLICT",
      "Forum runtime observation requires the actual private Pod address",
    );
  return `http://${ip}:8082`;
}
async function json(url: URL, token: string, transport: Transport) {
  const response = await transport(url, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new DeliveryError(
      "PAUSED",
      `Independent forum observation unavailable (${String(response.status)})`,
    );
  const bytes = await response.text();
  if (bytes.length > 4 * 1024 * 1024)
    throw new DeliveryError(
      "INVALID",
      "Forum native observation exceeds bounded response size",
    );
  return JSON.parse(bytes) as unknown;
}
async function installedStatus(
  request: { namespace: string; pod: string; uid: string },
  address: string,
  options: Options & { legacy: boolean },
) {
  if (options.legacy)
    return (options.nativeReader ?? createNativeForumReader())(request);
  if (options.observationToken === undefined)
    throw new DeliveryError(
      "PAUSED",
      "Authenticated forum runtime observation is not provisioned",
    );
  return ForumRuntimeStatusSchema.parse(
    await json(
      new URL("/_delivery/status", privatePodOrigin(address)),
      options.observationToken,
      options.fetch ?? fetch,
    ),
  );
}

async function observe(
  context: ForumBaselineContext,
  options: Options & { argoToken: string; legacy: boolean },
) {
  const definition = stepApplicationOf(
    context.pipeline.definition,
    "forum-bundle",
  );
  if (
    definition === null ||
    forumReleaseOf(context.pipeline.definition) === undefined
  )
    throw new DeliveryError(
      "INVALID",
      "Forum baseline requires its canonical Argo policy",
    );
  const transport = options.fetch ?? fetch,
    path = `/api/v1/applications/${encodeURIComponent(definition.name)}`;
  const namespace = definition.name;
  if (definition.namespace !== namespace)
    throw new DeliveryError(
      "INVALID",
      "Forum native inspection requires its fixed canonical namespace",
    );
  const argo = Application.parse(
    await json(new URL(path, options.argoOrigin), options.argoToken, transport),
  );
  if (
    argo.metadata.name !== definition.name ||
    (argo.operation !== undefined && argo.operation !== null)
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum Application has an active or mismatched operation",
    );
  async function resource(kind: string, name: string) {
    const url = new URL(`${path}/resource`, options.argoOrigin);
    url.search = new URLSearchParams({
      group: ["Pod", "PersistentVolumeClaim"].includes(kind)
        ? ""
        : kind === "Job"
          ? "batch"
          : "apps",
      version: "v1",
      kind,
      namespace,
      resourceName: name,
    }).toString();
    const response = z
      .object({ manifest: z.string() })
      .parse(await json(url, options.argoToken, transport));
    return JSON.parse(response.manifest) as unknown;
  }
  const originalStorage = await observeForumStorage(resource);
  await requireOriginalDatabase(resource);
  const jobs = argo.status.resources.filter(
      (entry) =>
        entry.kind === "Job" && entry.namespace === definition.namespace,
    ),
    job = jobs[0];
  if (job === undefined || jobs.length !== 1)
    throw new DeliveryError(
      "CONFLICT",
      "Forum baseline requires one current managed release Job",
    );
  const releaseJob = nativeJob(await resource("Job", job.name), context);
  const tree = Tree.parse(
    await json(
      new URL(`${path}/resource-tree`, options.argoOrigin),
      options.argoToken,
      transport,
    ),
  );
  const deployment = z
    .object({ metadata: Metadata })
    .parse(await resource("Deployment", "storm-forum-web"));
  const replicas = tree.nodes.filter(
    (node) =>
      node.kind === "ReplicaSet" &&
      node.namespace === definition.namespace &&
      node.parentRefs.some((parent) => parent.uid === deployment.metadata.uid),
  );
  const pods = tree.nodes
    .filter(
      (node) =>
        node.kind === "Pod" &&
        node.namespace === definition.namespace &&
        node.parentRefs.some((parent) =>
          replicas.some((replica) => replica.uid === parent.uid),
        ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  if (pods.length === 0 || pods.length > 20)
    throw new DeliveryError(
      "CONFLICT",
      "Forum original web workload has no bounded ready Pod set",
    );
  const proofs = [];
  let installed: z.infer<typeof ForumRuntimeStatusSchema> | undefined;
  for (const node of pods) {
    const { pod, proof } = nativePod(
      await resource("Pod", node.name),
      context,
      deployment.metadata.uid,
    );
    if (
      pod.metadata.uid !== node.uid ||
      !pod.metadata.ownerReferences.some((owner) =>
        node.parentRefs.some((parent) => parent.uid === owner.uid),
      )
    )
      throw new DeliveryError(
        "CONFLICT",
        "Forum runtime Pod owner changed during inspection",
      );
    const status = await installedStatus(
      { namespace, pod: pod.metadata.name, uid: pod.metadata.uid },
      pod.status.podIP,
      options,
    );
    if (
      installed !== undefined &&
      fingerprint(installed) !== fingerprint(status)
    )
      throw new DeliveryError(
        "CONFLICT",
        "Forum Pods disagree about installed version or bundle",
      );
    installed = status;
    proofs.push(proof);
  }
  if (
    fingerprint(originalStorage) !==
    fingerprint(await observeForumStorage(resource))
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum original PVC identity changed during installed runtime observation",
    );
  return ForumBaselineProofSchema.parse({
    environmentId: context.environment.id,
    observedAt: new Date().toISOString(),
    application: {
      name: argo.metadata.name,
      uid: argo.metadata.uid,
      resourceVersion: argo.metadata.resourceVersion,
      sourceFingerprint: fingerprint(argo.spec.source),
    },
    runtimeImage: `${context.image.uri}@${context.image.digest}`,
    imageArtifactId: context.image.id,
    bundleArtifactId: context.bundle.id,
    bundleDigest: context.bundle.digest,
    runtime: installed,
    storage: originalStorage,
    pods: proofs,
    releaseJob,
  });
}

/** Read native source, completed Job, actual Pod digests and authenticated installed DB status twice; callers supply no evidence. */
export function createForumBaselineInspector(
  options: Options,
): InspectForumBaseline {
  return async (context) => {
    if (options.argoToken === undefined)
      throw new DeliveryError(
        "PAUSED",
        "Independent forum observation credentials are not provisioned",
      );
    const original =
      options.policyReader === undefined
        ? await (
            options.originalPolicyReader ?? createOriginalForumPolicyReader()
          )(context.image.sourceRevision)
        : {
            policy: await options.policyReader(context.image.sourceRevision),
            legacy: false,
          };
    requireBundlePolicy(context.bundle, original.policy);
    if (!original.legacy && options.observationToken === undefined)
      throw new DeliveryError(
        "PAUSED",
        "Authenticated forum runtime observation is not provisioned",
      );
    const complete = {
        ...options,
        argoToken: options.argoToken,
        legacy: original.legacy,
      },
      before = await observe(context, complete),
      after = await observe(context, complete);
    const { observedAt: _beforeTime, ...first } = before,
      { observedAt: _afterTime, ...second } = after;
    if (fingerprint(first) !== fingerprint(second))
      throw new DeliveryError(
        "CONFLICT",
        "Forum native identities changed between independent observations",
      );
    return after;
  };
}
