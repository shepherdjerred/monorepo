import { Connection } from "@temporalio/client";
import { z } from "zod";
import type {
  DeploymentDetail,
  EvidenceInput,
  WorkerPoolSnapshot,
} from "@shepherdjerred/delivery/contract";
import { deliveryWorkerPool } from "#lib/delivery/workers/worker-pool.ts";
import {
  deliveryOperationId,
  deliverySelection,
} from "#lib/delivery/selection.ts";
import {
  retirementEffects,
  requirePoolRoutingCoverage,
} from "#lib/delivery/workers/worker-retirement.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { argoRequest } from "#activities/delivery/argocd.ts";
import { workerSourceFingerprint } from "#lib/delivery/workers/worker-source.ts";
import { SettledArgoStatusSchema } from "#lib/delivery/argocd-proof.ts";
import {
  requireLegacyWorkerCoverage,
  verifyWorkerBaselinePods,
  verifyWorkerPoolPollers,
  workerApplicationResources,
} from "#lib/delivery/workers/worker-hosts.ts";

export type WorkerBaselineEffects = {
  application: (name: string) => Promise<unknown>;
  resources: (
    application: string,
    kind: "Deployment" | "Pod",
  ) => Promise<unknown[]>;
  pollers: typeof verifyWorkerPoolPollers;
  routing: (pool: WorkerPoolSnapshot) => Promise<unknown>;
};
const external: WorkerBaselineEffects = {
  application: async (name) => await argoRequest(encodeURIComponent(name)),
  resources: async (application, kind) =>
    await workerApplicationResources(application, kind, argoRequest),
  pollers: verifyWorkerPoolPollers,
  async routing(pool) {
    const connection = await Connection.connect({
      address:
        "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
      connectTimeout: "10 seconds",
    });
    try {
      return await connection.withDeadline(Date.now() + 30_000, async () => {
        const effects = retirementEffects(connection);
        await requirePoolRoutingCoverage(pool, effects.routing);
        const routes = pool.versions[0]?.host.routes;
        if (routes === undefined) throw new Error("Missing baseline routes");
        const receipts = [];
        for (const route of routes)
          receipts.push({ ...route, ...(await effects.routing(route)) });
        if (receipts[0]?.currentBuildId !== pool.candidateBuildId)
          throw new Error(
            "Baseline candidate is not the primary routed version",
          );
        return receipts;
      });
    } finally {
      await connection.close();
    }
  },
};

/** Host adoption never selects a source, starts an operation, or claims full-app acceptance. */
export async function observeWorkerBaseline(
  detail: DeploymentDetail,
  effects: WorkerBaselineEffects = external,
): Promise<EvidenceInput[]> {
  const pool = deliveryWorkerPool(detail);
  if (
    detail.deployment.kind !== "adopt-worker" ||
    pool?.workerOperation !== "baseline"
  )
    throw new Error("Not a host-only baseline request");
  if (
    !detail.stages.some(
      (stage) =>
        stage.key === "worker-image-provenance" && stage.status === "succeeded",
    )
  )
    throw new Error("Baseline lacks original image Build ID inspection");
  const { selection, chart } = deliverySelection(detail);
  const expected = {
    repoURL: selection.repository,
    chart: selection.chart,
    targetRevision: chart.version,
  };
  const observation = z.object({
    operation: z.null().optional(),
    spec: z.object({
      source: z.object({
        repoURL: z.string(),
        chart: z.string(),
        targetRevision: z.string(),
      }),
    }),
    status: SettledArgoStatusSchema,
  });
  const observed = await effects.application(selection.application);
  const fingerprint = workerSourceFingerprint(observed);
  if (
    !detail.stages.some(
      (stage) =>
        stage.key === "worker-prior-source" &&
        stage.status === "succeeded" &&
        stage.operationId === fingerprint,
    )
  )
    throw new Error(
      "Baseline source identity changed after its read-only capture",
    );
  const stable = observation.parse(observed);
  if (
    JSON.stringify(stable.spec.source) !== JSON.stringify(expected) ||
    stable.status.sync.revision !== chart.version
  )
    throw new Error("Baseline source is not the exact qualified chart");
  const before = await effects.routing(pool);
  requireLegacyWorkerCoverage(
    await effects.resources(selection.application, "Deployment"),
    pool,
  );
  const pods = await effects.resources(selection.application, "Pod");
  verifyWorkerBaselinePods(pods, pool);
  await effects.pollers(pool);
  const after = await effects.routing(pool);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Baseline routing changed during independent observation");
  const final = await effects.application(selection.application);
  if (
    workerSourceFingerprint(final) !== fingerprint ||
    JSON.stringify(stable) !== JSON.stringify(observation.parse(final))
  )
    throw new Error("Baseline Application changed during observation");
  const operationId = deliveryOperationId(
    `${detail.deployment.id}:worker-baseline`,
  );
  return [
    {
      kind: "reconciliation",
      operationId,
      summary: `Host-only baseline observed immutable chart ${chart.id}; no Application source or routing mutation`,
    },
    {
      kind: "acceptance",
      operationId,
      summary: `Original qualified hosts, runtime digests and all route pollers independently observed: ${JSON.stringify(after)}`,
    },
  ];
}

export async function acceptWorkerBaseline(
  detail: DeploymentDetail,
): Promise<EvidenceInput[]> {
  const evidence = await observeWorkerBaseline(detail);
  await deliveryRequest(
    `deployments/${encodeURIComponent(detail.deployment.id)}/stages`,
    z.unknown(),
    {
      key: "worker-baseline",
      status: "succeeded",
      operationId: deliveryOperationId(
        `${detail.deployment.id}:worker-baseline`,
      ),
      message:
        "Independently observed original hosts; full-app release pointers remain unchanged",
      evidence,
    },
  );
  return evidence;
}
