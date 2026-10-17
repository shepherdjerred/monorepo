import { z } from "zod";
import type {
  ArtifactVersion,
  DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { argoRequest } from "./argocd.ts";

const PodSchema = z.object({
  metadata: z.object({
    deletionTimestamp: z.string().optional(),
    ownerReferences: z.array(z.object({ kind: z.string() })).optional(),
  }),
  spec: z.object({
    containers: z.array(z.object({ name: z.string(), image: z.string() })),
  }),
  status: z.object({
    phase: z.string(),
    containerStatuses: z
      .array(
        z.object({
          name: z.string(),
          ready: z.boolean(),
          imageID: z.string(),
          state: z.object({ running: z.unknown().optional() }),
        }),
      )
      .optional(),
  }),
});

function ignorablePod(pod: z.infer<typeof PodSchema>): boolean {
  return (
    pod.metadata.deletionTimestamp !== undefined ||
    (pod.status.phase === "Succeeded" &&
      pod.metadata.ownerReferences?.some((owner) => owner.kind === "Job") ===
        true)
  );
}

export function verifyDeliveryPods(
  inputs: unknown[],
  artifacts: ArtifactVersion[],
): void {
  if (artifacts.length === 0)
    throw new Error("Application pipeline declares no runtime image bindings");
  const witnessed = new Set<string>();
  for (const input of inputs) {
    const pod = PodSchema.parse(input);
    if (ignorablePod(pod)) continue;
    for (const container of pod.spec.containers) {
      const artifact = artifacts.find(
        (candidate) =>
          container.image.startsWith(`${candidate.uri}@`) ||
          container.image.startsWith(`${candidate.uri}:`),
      );
      if (artifact === undefined) continue;
      const status = pod.status.containerStatuses?.find(
        (candidate) => candidate.name === container.name,
      );
      const digest = /sha256:[a-f0-9]{64}$/u.exec(status?.imageID ?? "")?.[0];
      const runtimeDigests = artifact.runtimeDigests;
      if (
        digest === undefined ||
        pod.status.phase !== "Running" ||
        container.image !== `${artifact.uri}@${artifact.digest}` ||
        status?.ready !== true ||
        status.state.running === undefined ||
        ![artifact.digest, ...runtimeDigests].includes(digest)
      )
        throw new Error(
          `Running container for ${artifact.component} does not prove the selected image digest`,
        );
      witnessed.add(artifact.id);
    }
  }
  if (artifacts.some((artifact) => !witnessed.has(artifact.id)))
    throw new Error(
      "Not every selected runtime image has a ready running container",
    );
}

export async function observeDeliveryPods(
  detail: DeploymentDetail,
): Promise<void> {
  const pipeline = detail.pipeline.definition;
  if (pipeline.kind !== "argocd")
    throw new Error("Unsupported runtime observation adapter");
  const application = encodeURIComponent(pipeline.application);
  const tree = z
    .object({
      nodes: z.array(
        z.object({
          kind: z.string(),
          name: z.string(),
          namespace: z.string().optional(),
        }),
      ),
    })
    .parse(await argoRequest(`${application}/resource-tree`));
  const pods = [];
  for (const node of tree.nodes.filter((entry) => entry.kind === "Pod")) {
    const query = new URLSearchParams({
      resourceName: node.name,
      kind: "Pod",
      group: "",
      version: "v1",
      ...(node.namespace === undefined ? {} : { namespace: node.namespace }),
    });
    const response = z
      .object({ manifest: z.string() })
      .parse(await argoRequest(`${application}/resource?${query.toString()}`));
    const pod: unknown = JSON.parse(response.manifest);
    pods.push(pod);
  }
  const artifacts = Object.values(pipeline.artifactParameters).map(
    (component) => {
      const artifact = detail.versionSet.components[component];
      if (artifact?.kind !== "image")
        throw new Error("Runtime component is not an image");
      return artifact;
    },
  );
  verifyDeliveryPods(pods, artifacts);
}
