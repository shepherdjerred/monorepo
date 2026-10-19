import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  deliverySelectionPatch,
  type DeliverySelection,
} from "homelab/scripts/argocd/argocd-delivery.ts";
import { workerApplicationResources } from "./workers/worker-hosts.ts";
import {
  ManagedResourcesSchema,
  parseObject,
} from "homelab/scripts/argocd/argocd-apply-safety.ts";

const Metadata = z.object({
  name: z.string(),
  namespace: z.string().optional(),
  uid: z.string().min(1),
  deletionTimestamp: z.string().optional(),
  finalizers: z.array(z.string()).optional(),
  ownerReferences: z.array(z.object({ uid: z.string() })).optional(),
  annotations: z.record(z.string(), z.string()).optional(),
});
const Job = z.object({
  apiVersion: z.literal("batch/v1"),
  kind: z.literal("Job"),
  metadata: Metadata,
  status: z.object({
    active: z.number().optional(),
    conditions: z.array(z.object({ type: z.string(), status: z.string() })),
  }),
});
const Pod = z.object({
  metadata: Metadata,
  status: z.object({ phase: z.string() }),
});

function assertTerminalJob(
  job: z.infer<typeof Job>,
  context: {
    cached: z.infer<typeof Job>;
    application: string;
    namespace: string;
    name: string;
    pods: z.infer<typeof Pod>[];
    seen: Set<string>;
  },
) {
  const { cached, application, namespace, name, pods, seen } = context;
  if (
    job.metadata.uid !== cached.metadata.uid ||
    job.metadata.name !== name ||
    job.metadata.namespace !== namespace ||
    seen.has(job.metadata.uid) ||
    job.metadata.deletionTimestamp !== undefined ||
    (job.metadata.finalizers?.length ?? 0) !== 0 ||
    (job.metadata.ownerReferences?.length ?? 0) !== 0 ||
    job.metadata.annotations?.["argocd.argoproj.io/hook"] !== undefined ||
    job.metadata.annotations?.["argocd.argoproj.io/tracking-id"] !==
      `${application}:batch/Job:${namespace}/${name}` ||
    (job.status.active ?? 0) !== 0 ||
    !job.status.conditions.some(
      (condition) =>
        ["Complete", "Failed"].includes(condition.type) &&
        condition.status === "True",
    )
  )
    throw new Error(
      "Prior Forum migration Job is not an owned terminal resource",
    );
  if (
    pods.some(
      (pod) =>
        pod.metadata.ownerReferences?.some(
          (owner) => owner.uid === job.metadata.uid,
        ) === true && !["Succeeded", "Failed"].includes(pod.status.phase),
    )
  )
    throw new Error(
      "Prior Forum migration Job is not an owned terminal resource",
    );
  seen.add(job.metadata.uid);
}

/** A new Forum release replaces only terminal migration Jobs; journals live on PVCs. */
export async function forumSyncPrunes(
  selection: DeliverySelection,
  read: (path: string) => Promise<unknown>,
): Promise<boolean> {
  if (selection.parameters["delivery.releaseId"] === undefined) return false;
  if (
    !["storm-forum", "storm-forum-beta"].includes(selection.application) ||
    selection.chart !== selection.application ||
    selection.namespace !== selection.application ||
    !/^[a-f0-9]{12}(?:[a-f0-9]{20})?$/u.test(
      selection.parameters["delivery.releaseId"],
    )
  )
    throw new Error("Forum pruning requires the exact registered Forum scope");
  const app = encodeURIComponent(selection.application);
  const Application = z.object({
    metadata: z.object({ uid: z.string().min(1) }),
    spec: z.object({ source: z.unknown() }).loose(),
  });
  const before = await read(`${app}?refresh=hard`);
  const frozen = Application.parse(before);
  const patch = deliverySelectionPatch(before, selection);
  if (canonicalJson(patch[2]?.value) !== canonicalJson(frozen.spec.source))
    throw new Error("Forum source must already match its frozen selection");
  const desired = z
    .object({ manifests: z.array(z.string()) })
    .parse(
      await read(
        `${app}/manifests?revision=${encodeURIComponent(selection.revision)}`,
      ),
    )
    .manifests.map((manifest) =>
      z
        .object({
          apiVersion: z.string(),
          kind: z.string(),
          metadata: z.object({
            name: z.string(),
            namespace: z.string().optional(),
          }),
        })
        .parse(JSON.parse(manifest)),
    );
  const release = `storm-forum-release-${selection.parameters["delivery.releaseId"]}`;
  if (
    !desired.some(
      (resource) =>
        resource.apiVersion === "batch/v1" &&
        resource.kind === "Job" &&
        resource.metadata.name === release &&
        (resource.metadata.namespace ?? selection.namespace) ===
          selection.namespace,
    )
  )
    throw new Error("Selected Forum manifest lacks its exact new release Job");
  const response = await read(`${app}/managed-resources`);
  const managed = ManagedResourcesSchema.parse(response).items;
  const obsolete = managed.filter(
    (resource) =>
      parseObject(resource.liveState, resource, "liveState") !== null &&
      parseObject(resource.targetState, resource, "targetState") === null,
  );
  const rawPods =
    obsolete.length === 0
      ? []
      : await workerApplicationResources(selection.application, "Pod", read);
  const pods = rawPods.map((pod) => Pod.parse(pod));
  const seen = new Set<string>();
  for (const resource of obsolete) {
    if (
      resource.group !== "batch" ||
      resource.kind !== "Job" ||
      resource.namespace !== selection.namespace ||
      !/^storm-forum-release-[a-f0-9]{12}(?:[a-f0-9]{20})?$/u.test(
        resource.name,
      )
    )
      throw new Error("Forum sync refuses unrelated or storage pruning");
    if (
      desired.some(
        (target) =>
          target.apiVersion === "batch/v1" &&
          target.kind === "Job" &&
          target.metadata.name === resource.name &&
          (target.metadata.namespace ?? selection.namespace) ===
            resource.namespace,
      )
    )
      throw new Error("Forum prune candidate remains in the selected render");
    const query = new URLSearchParams({
      namespace: resource.namespace,
      resourceName: resource.name,
      group: "batch",
      version: "v1",
      kind: "Job",
    });
    const result = z
      .object({ manifest: z.string() })
      .parse(await read(`${app}/resource?${query.toString()}`));
    const job = Job.parse(JSON.parse(result.manifest));
    const cached = Job.parse(JSON.parse(resource.liveState ?? "null"));
    assertTerminalJob(job, {
      cached,
      application: selection.application,
      namespace: resource.namespace,
      name: resource.name,
      pods,
      seen,
    });
  }
  const after = await read(app);
  deliverySelectionPatch(after, selection);
  const settled = Application.parse(after);
  if (
    settled.metadata.uid !== frozen.metadata.uid ||
    canonicalJson(settled.spec) !== canonicalJson(frozen.spec)
  )
    throw new Error(
      "Forum source or Application incarnation changed before sync",
    );
  return obsolete.length > 0;
}
