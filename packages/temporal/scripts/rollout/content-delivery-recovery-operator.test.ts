import { describe, expect, it } from "vitest";
import {
  ContentRecoveryContextSchema,
  type ContentRecoveryContext,
} from "@shepherdjerred/delivery/contract";
import type { deliveryRequest } from "#lib/delivery/client.ts";
import {
  artifact,
  detail,
  recipe,
  timestamp,
} from "#lib/delivery/model/testing.ts";
import { isBarrierFencedDeploymentWorkflow } from "./content-delivery-recovery-operator.ts";

const chart = artifact({
  id: "chart/1",
  component: "chart:arcade",
  kind: "chart",
  uri: "oci://registry.example/arcade",
  version: "1.0.0",
  character: "b",
});

const appRecipe = recipe(
  { repoURL: "https://registry.example/charts", chart: "arcade" },
  "chart:arcade",
);

function recoveryContext(options: {
  withBarrier: boolean;
  barrierRestoredAt?: string | null;
}): ContentRecoveryContext {
  const target = detail(appRecipe, chart);
  target.deployment.status = "failed";
  target.deployment.recoveryRequired = true;
  return ContentRecoveryContextSchema.parse({
    intent: {
      id: "content-intent/1",
      deploymentId: target.deployment.id,
      requestedBy: "operator",
      reason: "Repair interrupted static-site activation under barrier",
      expectedEnvironmentGeneration: 1,
      snapshotFingerprint: "a".repeat(64),
      status: "pending",
      message: null,
      createdAt: timestamp,
      finishedAt: null,
      targetKind: "static-site",
      nativeReceipts: [],
      dispatchBarrier: options.withBarrier
        ? {
            adapter: "control-plane-dispatch-barrier/v1",
            deploymentUID: "uid-worker",
            templateFingerprint: "c".repeat(64),
            priorReplicas: 1,
            podUIDs: ["pod-1"],
            replicaSetUIDs: ["rs-1"],
          }
        : null,
      barrierRestoredAt: options.barrierRestoredAt ?? null,
    },
    deployment: target,
    priorDeployment: null,
    expectedSettlements: { desired: "d".repeat(64) },
    recoveryHistory: [],
  });
}

function candidateDeployment(overrides: {
  id?: string;
  status?: "queued" | "running" | "failed";
  workflowId?: string | null;
  stages?: { key: string; status: "running" | "succeeded" | "failed" }[];
}) {
  const built = detail(appRecipe, chart, overrides.stages ?? []);
  built.deployment.id = overrides.id ?? "queued-dep-1";
  built.deployment.status = overrides.status ?? "queued";
  built.deployment.workflowId = overrides.workflowId ?? null;
  return built;
}

describe("isBarrierFencedDeploymentWorkflow (AI-845)", () => {
  it("allows a running deliveryDeploymentWorkflow whose deployment is queued, unclaimed and stageless while barrier is held", async () => {
    const context = recoveryContext({ withBarrier: true });
    const queued = candidateDeployment({
      id: "queued-dep-1",
      status: "queued",
      workflowId: null,
      stages: [],
    });
    const allowed = await isBarrierFencedDeploymentWorkflow(
      context,
      {
        type: "deliveryDeploymentWorkflow",
        workflowId: "delivery/queued-dep-1",
      },
      async (route, schema) => {
        expect(route).toBe("deployments/queued-dep-1");
        return schema.parse(queued);
      },
    );
    expect(allowed).toBe(true);
  });

  it("refuses open workflows before the producer barrier is journaled or after restoration", async () => {
    const queued = candidateDeployment({});
    const api: typeof deliveryRequest = async (_route, schema) =>
      schema.parse(queued);

    expect(
      await isBarrierFencedDeploymentWorkflow(
        recoveryContext({ withBarrier: false }),
        {
          type: "deliveryDeploymentWorkflow",
          workflowId: "delivery/queued-dep-1",
        },
        api,
      ),
    ).toBe(false);

    expect(
      await isBarrierFencedDeploymentWorkflow(
        recoveryContext({ withBarrier: true, barrierRestoredAt: timestamp }),
        {
          type: "deliveryDeploymentWorkflow",
          workflowId: "delivery/queued-dep-1",
        },
        api,
      ),
    ).toBe(false);
  });

  it("refuses non-deployment workflows, claimed deployments, staged deployments and the recovery target itself", async () => {
    const context = recoveryContext({ withBarrier: true });

    expect(
      await isBarrierFencedDeploymentWorkflow(context, {
        type: "deliveryDispatchWorkflow",
        workflowId: "delivery/queued-dep-1",
      }),
    ).toBe(false);

    expect(
      await isBarrierFencedDeploymentWorkflow(context, {
        type: "deliveryDeploymentWorkflow",
        workflowId: `delivery/${context.deployment.deployment.id}`,
      }),
    ).toBe(false);

    expect(
      await isBarrierFencedDeploymentWorkflow(context, {
        type: "deliveryDeploymentWorkflow",
        workflowId: "delivery/queued-dep-1/successor",
      }),
    ).toBe(false);

    for (const unsafe of [
      candidateDeployment({ status: "running" }),
      candidateDeployment({ workflowId: "delivery/queued-dep-1" }),
      candidateDeployment({
        stages: [{ key: "step-sync", status: "running" }],
      }),
    ]) {
      expect(
        await isBarrierFencedDeploymentWorkflow(
          context,
          {
            type: "deliveryDeploymentWorkflow",
            workflowId: "delivery/queued-dep-1",
          },
          async (_route, schema) => schema.parse(unsafe),
        ),
      ).toBe(false);
    }
  });
});
