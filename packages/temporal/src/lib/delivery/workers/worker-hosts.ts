import { z } from "zod";
import type {
  DeploymentDetail,
  WorkerPoolSnapshot,
  ArtifactVersion,
} from "@shepherdjerred/delivery/contract";
import { deliveryWorkerPool } from "#lib/delivery/workers/worker-pool.ts";
import { requireHealthyWorkflowPoller } from "#lib/worker-deployment-proofs.ts";
import { DeliveryPodSchema as Pod } from "#lib/delivery/pod-schema.ts";
const Deployment = z.object({
  metadata: z.object({ name: z.string() }),
  spec: z.object({
    replicas: z.number().int().nonnegative(),
    template: z.object({
      metadata: z.object({ labels: z.record(z.string(), z.string()) }),
      spec: z.object({
        containers: z
          .array(
            z.object({
              image: z.string(),
              env: z
                .array(
                  z.object({ name: z.string(), value: z.string().optional() }),
                )
                .default([]),
            }),
          )
          .length(1),
      }),
    }),
  }),
});

function family(pool: WorkerPoolSnapshot) {
  return pool.target === "central"
    ? "central-workflows"
    : `${pool.target}-workflows`;
}

export function requireLegacyWorkerCoverage(
  inputs: unknown[],
  pool: WorkerPoolSnapshot,
): boolean {
  let bootstrap = false;
  for (const input of inputs) {
    const identity = z
      .object({
        spec: z.object({
          template: z.object({
            metadata: z.object({
              labels: z.record(z.string(), z.string()).default({}),
            }),
          }),
        }),
      })
      .parse(input);
    if (
      identity.spec.template.metadata.labels["worker-family"] !== family(pool)
    )
      continue;
    const host = Deployment.parse(input);
    if (
      host.spec.template.metadata.labels["worker-family"] !== family(pool) ||
      host.metadata.name.includes("delivery-wf-") ||
      host.spec.replicas === 0
    )
      continue;
    bootstrap = true;
    const container = host.spec.template.spec.containers[0];
    const image = container?.image;
    const digest = /sha256:[a-f0-9]{64}$/u.exec(image ?? "")?.[0];
    const covered = pool.versions.filter(
      (worker) =>
        worker.replicas === 1 &&
        worker.digest === digest &&
        (image === worker.image ||
          image?.startsWith(
            `${worker.image.slice(0, worker.image.indexOf("@"))}:`,
          ) === true),
    );
    const original = covered[0];
    if (original === undefined || digest === undefined || covered.length !== 1)
      throw new Error(
        "A live legacy worker lacks exact qualified retained-pool coverage",
      );
    for (const env of container?.env ?? [])
      if (
        ["GIT_SHA", "TEMPORAL_WORKER_BUILD_ID"].includes(env.name) &&
        env.value !== original.buildId
      )
        throw new Error(
          "Legacy worker build environment differs from original retained image provenance",
        );
  }
  return bootstrap;
}

export function verifyWorkerPoolPods(
  inputs: unknown[],
  pool: WorkerPoolSnapshot,
): void {
  const pods = inputs
    .map((input) => Pod.parse(input))
    .filter((pod) => pod.metadata.labels["worker-family"] === family(pool));
  for (const pod of pods) {
    if (
      pod.spec.containers.some(
        (container) =>
          !pool.versions.some(
            (worker) =>
              container.image.endsWith(`@${worker.digest}`) &&
              (container.image === worker.image ||
                container.image.startsWith(
                  `${worker.image.slice(0, worker.image.indexOf("@"))}:`,
                )),
          ),
      )
    )
      throw new Error(
        "Application has a worker Pod outside the frozen original image pool",
      );
  }
  for (const worker of pool.versions) {
    const component = `${family(pool)}-retained-${worker.buildId.slice(0, 12)}`;
    const matching = pods.filter(
      (pod) =>
        pod.metadata.labels["component"] === component &&
        pod.metadata.labels["delivery.shepherdjerred.com/worker-build"] ===
          worker.buildId,
    );
    if (worker.replicas === 0) {
      if (
        pods.some((pod) =>
          pod.spec.containers.some((container) =>
            container.image.endsWith(`@${worker.digest}`),
          ),
        )
      )
        throw new Error(
          "Retired worker still has Pods, including terminating Pods",
        );
      continue;
    }
    const ready = matching.some((pod) => {
      if (
        pod.status.phase !== "Running" ||
        pod.metadata.deletionTimestamp !== undefined
      )
        return false;
      return (
        pod.spec.containers.length === 1 &&
        pod.spec.containers.every((container) => {
          const status = pod.status.containerStatuses.find(
            (entry) => entry.name === container.name,
          );
          const digest = /sha256:[a-f0-9]{64}$/u.exec(
            status?.imageID ?? "",
          )?.[0];
          return (
            container.image === worker.image &&
            status?.ready === true &&
            status.state.running !== undefined &&
            digest !== undefined &&
            [worker.digest, ...worker.runtimeDigests].includes(digest)
          );
        })
      );
    });
    if (!ready)
      throw new Error(
        "Retained worker host lacks a ready Pod with its exact immutable image",
      );
  }
}

export async function workerApplicationResources(
  application: string,
  kind: "Deployment" | "StatefulSet" | "Pod" | "ReplicaSet",
  read: (path: string) => Promise<unknown>,
): Promise<unknown[]> {
  const app = encodeURIComponent(application);
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
    .parse(await read(`${app}/resource-tree`));
  const resources = [];
  for (const node of tree.nodes.filter((entry) => entry.kind === kind)) {
    const query = new URLSearchParams({
      resourceName: node.name,
      kind,
      group: kind === "Pod" ? "" : "apps",
      version: "v1",
      ...(node.namespace === undefined ? {} : { namespace: node.namespace }),
    });
    const result = z
      .object({ manifest: z.string() })
      .parse(await read(`${app}/resource?${query.toString()}`));
    resources.push(JSON.parse(result.manifest) as unknown);
  }
  return resources;
}

export async function verifyWorkerHosts(
  detail: DeploymentDetail,
  read: (path: string) => Promise<unknown>,
): Promise<void> {
  const pool = deliveryWorkerPool(detail);
  if (pool === undefined) return;
  const pods = await workerApplicationResources(
    pool.versions[0]?.host.application ?? "",
    "Pod",
    read,
  );
  verifyWorkerPoolPods(pods, pool);
  await verifyWorkerPoolPollers(pool);
}

function isDeliveryControlPlanePod(input: unknown): boolean {
  const pod = Pod.parse(input);
  return [
    "delivery-worker",
    "delivery-tsmc-controller",
    "delivery-platform-worker",
  ].includes(pod.metadata.labels["component"] ?? "");
}

/** Control-plane roles keep their own PG-selected original artifact throughout ordinary worker ramps. */
export function verifyControlPlaneArtifactPods(
  inputs: unknown[],
  artifact: ArtifactVersion,
): void {
  if (
    artifact.kind !== "image" ||
    artifact.component !== "image:temporal-worker" ||
    artifact.serviceId !== "temporal"
  )
    throw new Error("Missing original control-plane artifact");
  const expected = `${artifact.uri}:${artifact.version}@${artifact.digest}`;
  const pods = inputs
    .filter((input) => isDeliveryControlPlanePod(input))
    .map((input) => Pod.parse(input));
  if (
    !pods.some((pod) => pod.metadata.labels["component"] === "delivery-worker")
  )
    throw new Error("Frozen control-plane executor lacks its native Pod");
  for (const pod of pods) {
    if (
      pod.metadata.deletionTimestamp !== undefined ||
      pod.status.phase !== "Running"
    )
      throw new Error("Control-plane host is not stably running");
    for (const container of pod.spec.containers) {
      const status = pod.status.containerStatuses.find(
        (entry) => entry.name === container.name,
      );
      const digest = /sha256:[a-f0-9]{64}$/u.exec(status?.imageID ?? "")?.[0];
      if (
        digest === undefined ||
        status?.ready !== true ||
        container.image !== expected ||
        status.state.running === undefined ||
        ![artifact.digest, ...artifact.runtimeDigests].includes(digest)
      )
        throw new Error(
          "Control-plane Pod differs from its independently selected original image",
        );
    }
  }
}

export async function verifyWorkerPoolPollers(
  pool: WorkerPoolSnapshot,
): Promise<void> {
  for (const worker of pool.versions.filter((entry) => entry.replicas === 1)) {
    for (const route of worker.host.routes) {
      await requireHealthyWorkflowPoller(
        { ...route, buildId: worker.buildId },
        async (command) => {
          const expression = command[3];
          if (expression === undefined)
            throw new Error("Missing worker poller query");
          const url = new URL(
            "http://prometheus-kube-prometheus-prometheus.prometheus:9090/api/v1/query",
          );
          url.searchParams.set("query", expression);
          const response = await fetch(url, {
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) throw new Error("Worker poller observation failed");
          return { stdout: await response.text(), stderr: "" };
        },
        "retained",
      );
    }
  }
}

/** Baseline observes existing immutable image Pods without requiring Delivery host labels. */
export function verifyWorkerBaselinePods(
  inputs: unknown[],
  pool: WorkerPoolSnapshot,
): void {
  const pods = inputs
    .map((input) => Pod.parse(input))
    .filter((pod) => pod.metadata.labels["worker-family"] === family(pool));
  for (const worker of pool.versions.filter((entry) => entry.replicas === 1)) {
    const matching = pods.filter((pod) =>
      pod.spec.containers.some(
        (container) =>
          container.image.endsWith(`@${worker.digest}`) &&
          (container.image === worker.image ||
            container.image.startsWith(
              `${worker.image.slice(0, worker.image.indexOf("@"))}:`,
            )),
      ),
    );
    if (matching.length === 0)
      throw new Error("Baseline original worker image has no live host");
    for (const pod of matching) {
      const container = pod.spec.containers[0];
      const status = pod.status.containerStatuses.find(
        (entry) => entry.name === container?.name,
      );
      const digest = /sha256:[a-f0-9]{64}$/u.exec(status?.imageID ?? "")?.[0];
      if (
        digest === undefined ||
        pod.status.phase !== "Running" ||
        pod.spec.containers.length !== 1 ||
        pod.metadata.deletionTimestamp !== undefined ||
        status?.ready !== true ||
        status.state.running === undefined ||
        ![worker.digest, ...worker.runtimeDigests].includes(digest)
      )
        throw new Error(
          "Baseline worker does not prove its exact original runtime image",
        );
    }
  }
}
