import { describe, expect, test } from "vitest";
import {
  DeploymentDetailSchema,
  WorkerPoolSnapshotSchema,
  WorkerRolloutSnapshotSchema,
  type DeploymentDetail,
  type WorkerRolloutSnapshot,
} from "@shepherdjerred/delivery/contract";
import { RecipeDefinitionSchema } from "@shepherdjerred/delivery/model-contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import type { DeliveryJobRequest } from "#shared/delivery-job.ts";
import { deliveryJobManifest } from "#lib/delivery/job-manifest.ts";
import {
  DELIVERY_JOB_REQUEST_MAX_BYTES,
  deliveryJobRequestBytes,
  requireExecutableDeliveryJobRequest,
} from "#lib/delivery/job-request-limit.ts";
import { renderApplication } from "#lib/delivery/model/application.ts";
import { modelWorkerChartSelection } from "#lib/delivery/model/worker-selection.ts";
import {
  CANDIDATE,
  PLAN,
  STABLE,
  definition,
  retiringStable,
  temporal,
} from "./model-worker-fixture.ts";
import { retiredCentralWorkers } from "./worker-pool-fixture.ts";
import {
  verifyDeliveryWorkerImages,
  workerImageProofInput,
} from "./worker-image-proof.ts";
import { workerRoutingInput } from "./worker-acceptance.ts";
import { renderedWorkerPool, stageWorkerPool } from "./worker-pool.ts";

/** The bound a stage request stays under however long the pool's history grows. */
const STAGE_REQUEST_BOUND = 100 * 1024;
const connection = {
  address: "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
};

/** temporal/prod with its two live hosts and `retired` retired ones (1000 is the schema's cap). */
function withHistory(retired: number): DeploymentDetail {
  const current = temporal([]);
  const pool = current.deployment.workerSnapshot;
  if (pool === null) throw new Error("The fixture has no worker pool");
  return DeploymentDetailSchema.parse({
    ...current,
    deployment: {
      ...current.deployment,
      workerSnapshot: {
        ...pool,
        versions: [...pool.versions, ...retiredCentralWorkers(retired)],
      },
    },
  });
}

/** The pool the owned sync renders into the worker chart. */
function syncedPool(detail: DeploymentDetail) {
  const recipe = RecipeDefinitionSchema.parse(definition);
  if (recipe.kind !== "kubernetes-application")
    throw new Error("temporal is a Kubernetes application recipe");
  const value = renderApplication(detail, recipe).source.helm?.parameters?.find(
    (parameter) => parameter.name === "delivery.workerPool",
  )?.value;
  if (value === undefined) throw new Error("The sync renders no worker pool");
  // Helm `--set` escaping of the JSON's commas, brackets and braces.
  return WorkerPoolSnapshotSchema.parse(
    JSON.parse(value.replaceAll(/\\(.)/gu, "$1")),
  );
}

/** The request `workerJob` freezes into the stage's Job. */
function request(
  stageKey: string,
  recipe: DeliveryJobRequest["recipe"],
  input: unknown,
): DeliveryJobRequest {
  return {
    deploymentId: "25a3a20a-822f-4ab8-89b1-cb05ea8a544d",
    stageKey,
    recipe,
    runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"c".repeat(64)}`,
    sourceRevision: "d".repeat(40),
    input,
  };
}

function stageRequests(detail: DeploymentDetail) {
  return [
    request(
      "worker-image-provenance",
      "worker-images",
      workerImageProofInput(detail),
    ),
    request("worker-preflight", "worker-preflight", {
      ...workerRoutingInput(detail, null),
      connection,
    }),
    request("worker-promote", "worker-step", {
      ...workerRoutingInput(detail, null),
      plan: PLAN,
      action: "promote",
      connection,
    }),
  ];
}

/** The images the provenance Job inspects for `input`, each answering with its own Build ID. */
async function inspected(input: Pick<WorkerRolloutSnapshot, "deployment">) {
  const images: string[] = [];
  await verifyDeliveryWorkerImages(input, async (command) => {
    const image = command[4] ?? "";
    images.push(image);
    const worker = input.deployment.workerSnapshot?.versions.find(
      (entry) => entry.image === image,
    );
    return {
      stdout: JSON.stringify({
        os: "linux",
        architecture: "amd64",
        config: { Env: [`GIT_SHA=${worker?.buildId ?? ""}`] },
      }),
      stderr: "",
    };
  });
  return images;
}

describe("worker stage requests", () => {
  test("stay bounded however many retired hosts the pool keeps", () => {
    const detail = withHistory(998);
    expect(detail.deployment.workerSnapshot?.versions).toHaveLength(1000);
    for (const stage of stageRequests(detail)) {
      expect(deliveryJobRequestBytes(stage)).toBeLessThan(STAGE_REQUEST_BOUND);
      expect(() => {
        requireExecutableDeliveryJobRequest(stage);
      }).not.toThrow();
      const env = deliveryJobManifest(
        stage,
      ).spec?.template.spec?.containers[0]?.env?.find(
        (entry) => entry.name === "DELIVERY_JOB_REQUEST",
      );
      expect(Buffer.byteLength(env?.value ?? "")).toBe(
        deliveryJobRequestBytes(stage),
      );
    }
  });

  test("the whole pool, as the provenance Job carried it, outgrew the exec limit", () => {
    // The failing temporal/prod release froze a 60-version pool, 56 of them
    // retired, twice: in the detail and in the chart's rendered pool. The
    // chart now renders live hosts only, so the detail alone carries it here.
    const detail = withHistory(128);
    const frozen = request("worker-image-provenance", "worker-images", {
      detail: WorkerRolloutSnapshotSchema.parse(detail),
      controlPlane: modelWorkerChartSelection(detail),
    });
    expect(deliveryJobRequestBytes(frozen)).toBeGreaterThan(
      DELIVERY_JOB_REQUEST_MAX_BYTES,
    );
    expect(() => {
      requireExecutableDeliveryJobRequest(frozen);
    }).toThrow(/exceeds the 131050-byte exec limit/u);
    const [provenance] = stageRequests(detail);
    if (provenance === undefined) throw new Error("No provenance request");
    expect(deliveryJobRequestBytes(provenance)).toBeLessThan(
      STAGE_REQUEST_BOUND,
    );
  });

  test("the exec limit counts the variable name and its terminating NUL", () => {
    expect(DELIVERY_JOB_REQUEST_MAX_BYTES).toBe(
      131_072 - "DELIVERY_JOB_REQUEST=".length - 1,
    );
  });
});

describe("stage worker pool", () => {
  test("keeps every live host exactly and drops only retired ones", () => {
    const pool = withHistory(20).deployment.workerSnapshot;
    if (pool === null) throw new Error("The fixture has no worker pool");
    const staged = stageWorkerPool(pool);
    expect(staged.versions).toEqual(
      pool.versions.filter((worker) => worker.replicas === 1),
    );
    expect(staged.versions).toHaveLength(2);
    expect({ ...staged, versions: [] }).toEqual({ ...pool, versions: [] });
    expect(WorkerPoolSnapshotSchema.parse(staged)).toEqual(staged);
  });

  test("the sync and the provenance proof both render only the live hosts", () => {
    const detail = withHistory(20);
    const pool = detail.deployment.workerSnapshot;
    if (pool === null) throw new Error("The fixture has no worker pool");
    const synced = syncedPool(detail);
    const proof = workerImageProofInput(detail);
    const proved =
      proof.controlPlane?.selection.parameters["delivery.workerPool"] ?? "";
    expect(synced).toEqual(stageWorkerPool(pool));
    expect(JSON.parse(proved)).toEqual(synced);
    expect(proof.detail.deployment.workerSnapshot).toEqual(
      stageWorkerPool(pool),
    );
  });

  test("the provenance Job inspects the same images from the staged pool", async () => {
    const detail = withHistory(20);
    const staged = workerImageProofInput(detail).detail;
    expect(await inspected(staged)).toEqual(await inspected(detail));
    expect(await inspected(staged)).toHaveLength(2);
  });

  test("routing input carries the live hosts of the deployment and the restored acceptance", () => {
    const detail = withHistory(20);
    const input = workerRoutingInput(detail, null);
    expect(input.detail.deployment.workerSnapshot?.versions).toEqual(
      detail.deployment.workerSnapshot?.versions.filter(
        (worker) => worker.replicas === 1,
      ),
    );
    expect(canonicalJson(input).length).toBeLessThan(
      canonicalJson(WorkerRolloutSnapshotSchema.parse(detail)).length,
    );
  });
});

describe("rendered worker pool", () => {
  test("stays bounded by the live hosts however many retired ones the pool keeps", () => {
    const detail = withHistory(998);
    const pool = detail.deployment.workerSnapshot;
    if (pool === null) throw new Error("The fixture has no worker pool");
    const synced = syncedPool(detail);
    expect(synced.versions.map((worker) => worker.buildId)).toEqual([
      STABLE,
      CANDIDATE,
    ]);
    // Two hosts, where the whole 1000-version pool renders about a megabyte.
    expect(JSON.stringify(synced).length).toBeLessThan(4096);
    expect(JSON.stringify(pool).length).toBeGreaterThan(900_000);
  });

  test("a retirement renders its own retiring host at zero and drops earlier retired ones", () => {
    const current = retiringStable(temporal([]));
    const pool = current.deployment.workerSnapshot;
    if (pool === null) throw new Error("The fixture has no worker pool");
    const detail = DeploymentDetailSchema.parse({
      ...current,
      deployment: {
        ...current.deployment,
        workerSnapshot: {
          ...pool,
          versions: [...pool.versions, ...retiredCentralWorkers(3)],
        },
      },
    });
    const synced = syncedPool(detail);
    expect(
      synced.versions.map((worker) => [worker.buildId, worker.replicas]),
    ).toEqual([
      [STABLE, 0],
      [CANDIDATE, 1],
    ]);
    expect({ ...synced, versions: [] }).toEqual({ ...pool, versions: [] });
  });

  test("a retired build raised again by a rollback or redeploy renders its host again", () => {
    const pool = withHistory(3).deployment.workerSnapshot;
    if (pool === null) throw new Error("The fixture has no worker pool");
    const [raised] = retiredCentralWorkers(1);
    if (raised === undefined) throw new Error("No retired fixture host");
    const restored = WorkerPoolSnapshotSchema.parse({
      ...pool,
      versions: pool.versions.map((worker) =>
        worker.buildId === raised.buildId
          ? { ...worker, replicas: 1, retiredAt: null }
          : worker,
      ),
    });
    const rendered = renderedWorkerPool(restored).versions.map(
      (worker) => worker.buildId,
    );
    expect(rendered).toContain(raised.buildId);
    expect(rendered).toHaveLength(3);
  });
});
