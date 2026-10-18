import nodePath from "node:path";
import { z } from "zod";
import {
  MountBindingRequestSchema,
  MountEvidenceSchema,
  ObservedMountSchema,
  type MountBindingRequest,
} from "#shared/legacy-observer.ts";
import { LEGACY_OBSERVER_CONFIG } from "./config.ts";
import {
  observerDigest as snapshotHash,
  LegacyObservationError,
  ResourceSchema,
  type ObserverRequest,
} from "./wire.ts";
import type { Resource } from "./wire.ts";
import { readInventory } from "./inventory.ts";
import { canonicalWorkerPod } from "./worker-pod.ts";
const posix = nodePath.posix;

const PodSpec = z.object({
  containers: z.array(
    z.object({
      name: z.string(),
      volumeMounts: z
        .array(
          z.object({
            name: z.string(),
            mountPath: z.string(),
            subPath: z.string().optional(),
            subPathExpr: z.string().optional(),
            readOnly: z.boolean().optional(),
          }),
        )
        .default([]),
    }),
  ),
  volumes: z.array(
    z.object({
      name: z.string(),
      persistentVolumeClaim: z
        .object({ claimName: z.string(), readOnly: z.boolean().optional() })
        .optional(),
    }),
  ),
});
function cleanPath(path: string, absolute: boolean): string {
  if (
    path.includes("\0") ||
    path.includes("\\") ||
    path.split("/").includes("..") ||
    posix.isAbsolute(path) !== absolute ||
    (absolute && path === "/")
  )
    throw new LegacyObservationError("mount_path_invalid");
  return posix.normalize(path);
}
function mountPodSpec(deployment: Resource, inventory: Resource[]) {
  const worker =
    deployment.metadata.name === "media-media-files"
      ? canonicalWorkerPod(deployment, inventory)
      : undefined;
  const template =
    worker === undefined
      ? z
          .object({ template: z.object({ spec: PodSpec }) })
          .parse(deployment.spec).template.spec
      : PodSpec.parse(worker.pod.spec);
  const identity =
    worker === undefined
      ? {}
      : {
          podName: worker.pod.metadata.name,
          podUid: worker.pod.metadata.uid,
          podSpecDigest: snapshotHash(worker.pod.spec),
          replicaSetUid: worker.replicaSetUid,
        };
  return { template, identity };
}
export async function inspectMount(
  request: ObserverRequest,
  input: {
    deployment: string;
    container: string;
    root: string;
    inventory: Resource[];
  },
  signal: AbortSignal,
) {
  const raw = await request(
    `/apis/apps/v1/namespaces/media/deployments/${input.deployment}`,
    signal,
  );
  const deployment = ResourceSchema.parse(raw);
  if (
    deployment.kind !== "Deployment" ||
    deployment.metadata.name !== input.deployment ||
    deployment.metadata.deletionTimestamp !== undefined
  )
    throw new LegacyObservationError("mount_deployment_changed");
  const { template, identity } = mountPodSpec(deployment, input.inventory);
  const containers = template.containers.filter(
    (container) => container.name === input.container,
  );
  const container = containers[0];
  if (!container || containers.length !== 1)
    throw new LegacyObservationError("mount_container_ambiguous");
  const root = cleanPath(input.root, true);
  const matches = container.volumeMounts.filter(
    (mount) =>
      root === mount.mountPath || root.startsWith(`${mount.mountPath}/`),
  );
  if (matches.length !== 1) throw new LegacyObservationError("mount_ambiguous");
  const mount = matches[0];
  if (!mount || mount.subPathExpr !== undefined)
    throw new LegacyObservationError("mount_subpath_expression");
  const volumes = template.volumes.filter(
    (volume) => volume.name === mount.name,
  );
  const volume = volumes[0];
  if (volumes.length !== 1 || !volume?.persistentVolumeClaim)
    throw new LegacyObservationError("mount_not_unique_pvc");
  const mountPath = cleanPath(mount.mountPath, true);
  const subPath =
    mount.subPath === undefined || mount.subPath === ""
      ? ""
      : cleanPath(mount.subPath, false);
  const claimName = z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{0,252}$/u)
    .parse(volume.persistentVolumeClaim.claimName);
  const claim = ResourceSchema.parse(
    await request(
      `/api/v1/namespaces/media/persistentvolumeclaims/${claimName}`,
      signal,
    ),
  );
  if (
    claim.kind !== "PersistentVolumeClaim" ||
    claim.metadata.name !== claimName ||
    claim.metadata.deletionTimestamp !== undefined ||
    claim.status["phase"] !== "Bound"
  )
    throw new LegacyObservationError("pvc_not_bound");
  const volumeName = z.string().min(1).parse(claim.spec["volumeName"]);
  return ObservedMountSchema.parse({
    deployment: input.deployment,
    deploymentUid: deployment.metadata.uid,
    generation: deployment.metadata.generation,
    specDigest: snapshotHash(deployment.spec),
    container: input.container,
    root,
    mountPath,
    subPath,
    readOnly:
      mount.readOnly === true || volume.persistentVolumeClaim.readOnly === true,
    pvcName: claimName,
    pvcUid: claim.metadata.uid,
    volumeName,
    volumePath: posix.join(subPath, posix.relative(mountPath, root)),
    ...identity,
  });
}
async function readBindings(input: {
  request: ObserverRequest;
  bindings: MountBindingRequest[];
  signal: AbortSignal;
}) {
  const results = [];
  const inventory = await readInventory(input.request, input.signal);
  for (const binding of input.bindings) {
    if (
      !LEGACY_OBSERVER_CONFIG.legacyDeployments.includes(
        binding.sourceDeployment,
      ) ||
      binding.canonicalDeployment !== "media-media-files"
    )
      throw new LegacyObservationError("mount_deployment_outside_scope");
    const source = await inspectMount(
      input.request,
      {
        deployment: binding.sourceDeployment,
        container: binding.sourceContainer,
        root: binding.sourceRoot,
        inventory,
      },
      input.signal,
    );
    const canonical = await inspectMount(
      input.request,
      {
        deployment: binding.canonicalDeployment,
        container: binding.canonicalContainer,
        root: binding.canonicalRoot,
        inventory,
      },
      input.signal,
    );
    if (
      source.pvcUid !== canonical.pvcUid ||
      source.volumeName !== canonical.volumeName ||
      source.volumePath !== canonical.volumePath
    )
      throw new LegacyObservationError("mount_storage_identity_mismatch");
    results.push({
      source,
      canonical,
      evidenceHash: snapshotHash({ source, canonical }),
    });
  }
  return results;
}
export async function observeMounts(input: {
  request: ObserverRequest;
  bindings: MountBindingRequest[];
  signal: AbortSignal;
  now: () => number;
}) {
  const now = input.now();
  const bindings = z
    .array(MountBindingRequestSchema)
    .min(1)
    .max(100)
    .parse(input.bindings);
  const first = await readBindings({ ...input, bindings });
  const second = await readBindings({ ...input, bindings });
  if (snapshotHash(first) !== snapshotHash(second))
    throw new LegacyObservationError("mount_inventory_changed");
  return MountEvidenceSchema.parse({
    schemaVersion: 1,
    namespace: "media",
    capturedAt: new Date(now).toISOString(),
    expiresAt: new Date(
      now + LEGACY_OBSERVER_CONFIG.evidenceLifetimeMs,
    ).toISOString(),
    configurationDigest: snapshotHash(LEGACY_OBSERVER_CONFIG),
    bindings: second,
  });
}
