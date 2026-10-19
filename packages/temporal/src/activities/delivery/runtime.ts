import { z } from "zod";
import type {
  ArtifactVersion,
  DeploymentDetail,
} from "@shepherdjerred/delivery/contract";
import { argoRequest } from "./argocd.ts";
import { minecraftRuntimeImage } from "#lib/delivery/minecraft.ts";
import { DeliveryPodSchema as PodSchema } from "#lib/delivery/pod-schema.ts";
import {
  verifyRuntimeImageDigest,
  type RuntimeManifestReader,
} from "./runtime-image.ts";

function ignorablePod(pod: z.infer<typeof PodSchema>): boolean {
  return (
    pod.metadata.deletionTimestamp !== undefined ||
    (pod.status.phase === "Succeeded" &&
      pod.metadata.ownerReferences?.some((owner) => owner.kind === "Job") ===
        true)
  );
}

/** The selected chart owns this explicitly shared infrastructure image, rather than the worker artifact. */
function centralChartDependencies(manifests: string[]): Set<string> {
  const expected = new Set<string>();
  for (const manifest of manifests) {
    const raw: unknown = JSON.parse(manifest);
    const kind = z.object({ kind: z.string() }).parse(raw).kind;
    if (kind !== "Deployment") continue;
    const deployment = z
      .object({
        spec: z.object({
          template: z.object({
            spec: z.object({
              containers: z.array(z.object({ image: z.string() })),
            }),
          }),
        }),
      })
      .parse(raw);
    for (const container of deployment.spec.template.spec.containers) {
      if (!container.image.startsWith("docker.io/shepherdjerred/caddy-s3proxy"))
        continue;
      if (
        !/^docker\.io\/shepherdjerred\/caddy-s3proxy(?::[\w.-]+)?@sha256:[a-f0-9]{64}$/u.test(
          container.image,
        )
      )
        throw new Error("Chart dependency lacks an immutable Caddy digest");
      expected.add(container.image);
    }
  }
  if (expected.size === 0)
    throw new Error(
      "Central chart lacks its reviewed Caddy infrastructure dependency",
    );
  return expected;
}

export function verifyCentralChartDependencies(
  inputs: unknown[],
  manifests: string[],
) {
  const expected = centralChartDependencies(manifests);
  const observed = new Set<string>();
  for (const input of inputs) {
    const pod = PodSchema.parse(input);
    if (ignorablePod(pod)) continue;
    for (const container of pod.spec.containers.filter((entry) =>
      entry.image.startsWith("docker.io/shepherdjerred/caddy-s3proxy"),
    )) {
      const status = pod.status.containerStatuses.find(
        (entry) => entry.name === container.name,
      );
      if (
        !expected.has(container.image) ||
        pod.status.phase !== "Running" ||
        status?.ready !== true ||
        status.state.running === undefined ||
        !/sha256:[a-f0-9]{64}$/u.test(status.imageID)
      )
        throw new Error(
          "Running Caddy dependency does not match the selected chart",
        );
      observed.add(container.image);
    }
  }
  if ([...expected].some((image) => !observed.has(image)))
    throw new Error("Selected chart dependency has no ready running container");
}

export async function verifyDeliveryPods(
  inputs: unknown[],
  artifacts: ArtifactVersion[],
  exactReferences: ReadonlyMap<string, string> = new Map(),
  readManifest?: RuntimeManifestReader,
): Promise<void> {
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
      const status = pod.status.containerStatuses.find(
        (candidate) => candidate.name === container.name,
      );
      const digest = /sha256:[a-f0-9]{64}$/u.exec(status?.imageID ?? "")?.[0];
      if (
        digest === undefined ||
        pod.status.phase !== "Running" ||
        container.image !==
          (exactReferences.get(artifact.id) ??
            `${artifact.uri}@${artifact.digest}`) ||
        status?.ready !== true ||
        status.state.running === undefined
      )
        throw new Error(
          `Running container for ${artifact.component} does not prove the selected image digest`,
        );
      await verifyRuntimeImageDigest(
        artifact,
        status.imageID,
        status.image,
        readManifest,
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
  readArgo: (path: string) => Promise<unknown> = argoRequest,
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
    .parse(await readArgo(`${application}/resource-tree`));
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
      .parse(await readArgo(`${application}/resource?${query.toString()}`));
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
  const workerFamily = detail.deployment.workerSnapshot?.target;
  if (workerFamily === "central") {
    const desired = z
      .object({ manifests: z.array(z.string()) })
      .parse(await readArgo(`${application}/manifests`));
    verifyCentralChartDependencies(pods, desired.manifests);
  }
  if (workerFamily === undefined) {
    const references =
      pipeline.minecraftUpgrade === undefined
        ? new Map<string, string>()
        : new Map(
            artifacts.map((artifact) => [
              artifact.id,
              minecraftRuntimeImage(detail),
            ]),
          );
    await verifyDeliveryPods(pods, artifacts, references);
  } else if (artifacts.length > 0) {
    const family =
      workerFamily === "central"
        ? "central-workflows"
        : `${workerFamily}-workflows`;
    await verifyDeliveryPods(
      pods.filter(
        (pod) =>
          PodSchema.parse(pod).metadata.labels["worker-family"] !== family,
      ),
      artifacts,
    );
  }
}
