import { z } from "zod";
import { Connection } from "@temporalio/client";
import type { DeploymentDetail } from "@shepherdjerred/delivery/contract";
import type { DeliverySelection } from "homelab/scripts/argocd/argocd-delivery.ts";
import { deliveryWorkerPool } from "#lib/delivery/workers/worker-pool.ts";
import {
  deliveryOperationId,
  deliverySelection,
} from "#lib/delivery/selection.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import {
  requirePoolRoutingCoverage,
  retirementEffects,
} from "#lib/delivery/workers/worker-retirement.ts";
import {
  argoRequest,
  selectArgoRelease,
  syncArgoRelease,
  verifyArgoRelease,
} from "#activities/delivery/argocd.ts";
import {
  requireLegacyWorkerCoverage,
  workerApplicationResources,
} from "#lib/delivery/workers/worker-hosts.ts";
import { verifyWorkerHosts } from "./worker-hosts.ts";
import {
  requireIsolatedControlPlane,
  controlPlaneTemplates,
  ControlPlaneTemplatesSchema,
} from "#lib/delivery/workers/worker-control-plane.ts";

export type WorkerBootstrapEffects = {
  inspect: (
    application: string,
    kind: "Deployment" | "Pod",
  ) => Promise<unknown[]>;
  select: typeof selectArgoRelease;
  sync: typeof syncArgoRelease;
  verify: (selection: DeliverySelection, operationId: string) => Promise<void>;
  hosts: typeof verifyWorkerHosts;
  controlPlane: (detail: DeploymentDetail) => Promise<void>;
  routing: (
    pool: NonNullable<DeploymentDetail["deployment"]["workerSnapshot"]>,
  ) => Promise<void>;
};

const external: WorkerBootstrapEffects = {
  inspect: async (application, kind) =>
    await workerApplicationResources(application, kind, argoRequest),
  select: selectArgoRelease,
  sync: syncArgoRelease,
  hosts: verifyWorkerHosts,
  async controlPlane(detail) {
    if (detail.deployment.workerSnapshot?.target !== "central") return;
    const proof = detail.evidence.find(
      (entry) =>
        entry.kind === "preflight" &&
        entry.summary.startsWith('{"adapter":"worker-image-provenance"'),
    );
    if (proof === undefined)
      throw new Error("Control-plane candidate template proof is missing");
    const parsed = z
      .object({
        adapter: z.literal("worker-image-provenance"),
        controlPlaneTemplates: ControlPlaneTemplatesSchema,
      })
      .strict()
      .parse(JSON.parse(proof.summary));
    z.object({
      spec: z.object({
        source: z.object({
          helm: z
            .object({ parameters: z.array(z.unknown()).optional() })
            .strict()
            .optional(),
        }),
      }),
    }).parse(await argoRequest("temporal"));
    const resources = await Promise.all([
      workerApplicationResources("temporal", "Deployment", argoRequest),
      workerApplicationResources("temporal", "StatefulSet", argoRequest),
    ]);
    requireIsolatedControlPlane(parsed.controlPlaneTemplates);
    requireIsolatedControlPlane(controlPlaneTemplates(resources.flat()));
  },
  async verify(selection, operationId) {
    verifyArgoRelease(
      await argoRequest(encodeURIComponent(selection.application)),
      selection,
      operationId,
    );
  },
  async routing(pool) {
    const connection = await Connection.connect({
      address:
        "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
      connectTimeout: "10 seconds",
    });
    try {
      await connection.withDeadline(Date.now() + 30_000, async () => {
        await requirePoolRoutingCoverage(
          pool,
          retirementEffects(connection).routing,
        );
      });
    } finally {
      await connection.close();
    }
  },
};

/** Keep legacy pollers until exact replacement Pods and every served route are observed. */
export async function bootstrapDeliveryWorkerHosts(
  detail: DeploymentDetail,
  effects: WorkerBootstrapEffects = external,
): Promise<void> {
  const pool = deliveryWorkerPool(detail);
  if (pool === undefined) return;
  const { selection } = deliverySelection(detail);
  await effects.controlPlane(detail);
  if (
    pool.workerOperation === "rollout" &&
    !detail.stages.some(
      (stage) =>
        stage.key === "worker-image-provenance" && stage.status === "succeeded",
    )
  )
    throw new Error(
      "Retained images require baked Build ID inspection before source mutation",
    );
  await effects.routing(pool);
  const deployments = await effects.inspect(
    selection.application,
    "Deployment",
  );
  if (!requireLegacyWorkerCoverage(deployments, pool)) return;
  const bootstrap = {
    ...selection,
    parameters: { ...selection.parameters, "delivery.legacyWorkers": "keep" },
  };
  const operationId = deliveryOperationId(
    `${detail.deployment.id}:worker-bootstrap`,
  );
  const stagePath = `deployments/${encodeURIComponent(detail.deployment.id)}/stages`;
  await deliveryRequest(stagePath, z.unknown(), {
    key: "worker-host-bootstrap",
    status: "running",
    operationId,
    message: "Retain every legacy poller while starting exact retained hosts",
    evidence: [],
  });
  await effects.select(bootstrap);
  await effects.sync(bootstrap, operationId);
  await effects.verify(bootstrap, operationId);
  await effects.hosts(detail);
  await effects.routing(pool);
  requireLegacyWorkerCoverage(
    await effects.inspect(selection.application, "Deployment"),
    pool,
  );
  await deliveryRequest(stagePath, z.unknown(), {
    key: "worker-host-bootstrap",
    status: "succeeded",
    operationId,
    message:
      "Exact retained hosts and every served namespace/queue have healthy pollers; legacy shutdown may proceed",
    evidence: [
      {
        kind: "runtime",
        operationId,
        summary:
          "Legacy coverage and replacement Pod digests verified before legacy shutdown",
      },
    ],
  });
}
