import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";
import type { ForumBaselineContext } from "#shared/contract.ts";

export const Metadata = z.object({
  name: z.string().min(1),
  uid: z.string().min(1),
  resourceVersion: z.string().min(1),
  ownerReferences: z
    .array(z.object({ uid: z.string(), kind: z.string() }))
    .default([]),
});
const Container = z.object({
  name: z.string(),
  image: z.string(),
  env: z
    .array(z.object({ name: z.string(), value: z.string().optional() }))
    .default([]),
});
const FilesVolume = z.object({
  name: z.string(),
  persistentVolumeClaim: z.object({ claimName: z.string() }).optional(),
});
function requireOriginalFiles(volumes: z.infer<typeof FilesVolume>[]) {
  if (
    volumes.filter(
      (volume) =>
        volume.name === "files" &&
        volume.persistentVolumeClaim?.claimName === "storm-forum-files",
    ).length !== 1
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum workload does not mount the original files claim",
    );
}
export const Pod = z.object({
  metadata: Metadata,
  spec: z.object({
    containers: z.array(Container),
    initContainers: z.array(Container),
    volumes: z.array(FilesVolume),
  }),
  status: z.object({
    phase: z.literal("Running"),
    podIP: z.ipv4(),
    conditions: z.array(z.object({ type: z.string(), status: z.string() })),
    containerStatuses: z.array(
      z.object({ name: z.string(), ready: z.boolean(), imageID: z.string() }),
    ),
  }),
});
export const Job = z.object({
  metadata: Metadata,
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(Container),
        initContainers: z.array(Container),
        volumes: z.array(FilesVolume),
      }),
    }),
  }),
  status: z.object({
    succeeded: z.literal(1),
    active: z.number().optional(),
    completionTime: z.iso.datetime({ offset: true }),
    conditions: z.array(z.object({ type: z.string(), status: z.string() })),
  }),
});
export const Application = z.object({
  metadata: Metadata,
  spec: z.object({ source: z.record(z.string(), z.json()) }),
  operation: z.unknown().optional(),
  status: z.object({
    sync: z.object({ status: z.literal("Synced") }),
    health: z.object({ status: z.literal("Healthy") }),
    operationState: z.object({ phase: z.literal("Succeeded") }).optional(),
    resources: z.array(
      z.object({
        kind: z.string(),
        name: z.string(),
        namespace: z.string().optional(),
      }),
    ),
  }),
});
export const Tree = z.object({
  nodes: z.array(
    z.object({
      kind: z.string(),
      name: z.string(),
      namespace: z.string(),
      uid: z.string(),
      parentRefs: z.array(z.object({ uid: z.string() })).default([]),
    }),
  ),
});

function bootstrap(
  containers: z.infer<typeof Container>[],
  context: ForumBaselineContext,
  runtimeNames: string[],
) {
  const expectedImage = `${context.image.uri}@${context.image.digest}`;
  for (const name of runtimeNames) {
    const matches = containers.filter((container) => container.name === name),
      container = matches[0];
    if (matches.length !== 1 || container?.image !== expectedImage)
      throw new DeliveryError(
        "CONFLICT",
        "Forum native container does not use the original qualified runtime",
      );
    for (const [key, expected] of Object.entries({
      BUNDLE_BUCKET: "storm-forum-releases",
      BUNDLE_KEY: `releases/${context.bundle.digest.slice(7)}.zip`,
      BUNDLE_SHA256: context.bundle.digest.slice(7),
    })) {
      const fields = container.env.filter((env) => env.name === key);
      if (fields.length !== 1 || fields[0]?.value !== expected)
        throw new DeliveryError(
          "CONFLICT",
          "Forum native assembly inputs differ from the original qualified licensed bundle",
        );
    }
  }
}

export function nativeJob(raw: unknown, context: ForumBaselineContext) {
  const job = Job.parse(raw);
  if (
    !/^storm-forum-release-[a-z0-9-]+$/u.test(job.metadata.name) ||
    (job.status.active ?? 0) !== 0 ||
    !job.status.conditions.some(
      (condition) =>
        condition.type === "Complete" && condition.status === "True",
    )
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum baseline requires the actual completed release Job",
    );
  bootstrap(job.spec.template.spec.containers, context, ["release"]);
  bootstrap(job.spec.template.spec.initContainers, context, ["assemble"]);
  requireOriginalFiles(job.spec.template.spec.volumes);
  return {
    name: job.metadata.name,
    uid: job.metadata.uid,
    resourceVersion: job.metadata.resourceVersion,
    specFingerprint: fingerprint(
      z.object({ spec: z.record(z.string(), z.json()) }).parse(raw).spec,
    ),
    completedAt: job.status.completionTime,
  };
}

export function nativePod(
  raw: unknown,
  context: ForumBaselineContext,
  workloadUid: string,
) {
  const pod = Pod.parse(raw);
  bootstrap(pod.spec.containers, context, ["php", "activities"]);
  bootstrap(pod.spec.initContainers, context, ["assemble"]);
  requireOriginalFiles(pod.spec.volumes);
  if (
    !pod.status.conditions.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    ) ||
    pod.status.containerStatuses.some((container) => !container.ready)
  )
    throw new DeliveryError("CONFLICT", "Forum runtime Pod is not fully ready");
  const runtime = pod.status.containerStatuses.filter((container) =>
    ["php", "activities"].includes(container.name),
  );
  if (
    runtime.length !== 2 ||
    runtime.some(
      (container) =>
        !context.image.runtimeDigests.some(
          (digest) =>
            container.imageID.replace(/^docker-pullable:\/\//u, "") ===
            `${context.image.uri}@${digest}`,
        ),
    )
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum runtime Pod does not report original qualified platform digests",
    );
  const imageId = runtime[0]?.imageID.replace(/^docker-pullable:\/\//u, "");
  if (imageId === undefined)
    throw new DeliveryError("CONFLICT", "Forum runtime image identity missing");
  return {
    pod,
    proof: {
      name: pod.metadata.name,
      uid: pod.metadata.uid,
      resourceVersion: pod.metadata.resourceVersion,
      imageId,
      workloadUid,
    },
  };
}
