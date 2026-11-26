import {
  V1Job,
  V1JobCondition,
  V1JobStatus,
  V1ObjectMeta,
} from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import { model } from "#lib/k8s-model.ts";
import {
  DELIVERY_PLATFORM_JOBS_NAMESPACE,
  DELIVERY_REQUEST_ANNOTATION,
  DELIVERY_WORKER_JOBS_NAMESPACE,
  classifyDeliveryJobCandidate,
  isDeploymentSettledForJobReap,
  reapSettledDeliveryJobs,
  type DeliveryJobReaperNamespace,
} from "./job-reaper.ts";

function makeJob(options: {
  name: string;
  namespace?: string;
  uid?: string;
  deploymentId?: string;
  condition?: "Complete" | "Failed" | "Suspended";
  active?: number;
  deleting?: boolean;
  completionTime?: string;
}): V1Job {
  return model(V1Job, {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: model(V1ObjectMeta, {
      name: options.name,
      namespace: options.namespace ?? DELIVERY_WORKER_JOBS_NAMESPACE,
      uid: options.uid ?? `uid-${options.name}`,
      creationTimestamp: new Date("2026-11-01T00:00:00Z"),
      ...(options.deleting === true
        ? { deletionTimestamp: new Date("2026-11-10T00:00:00Z") }
        : {}),
      ...(options.deploymentId === undefined
        ? {}
        : {
            annotations: {
              [DELIVERY_REQUEST_ANNOTATION]: options.deploymentId,
            },
          }),
    }),
    status: model(V1JobStatus, {
      ...(options.active === undefined ? {} : { active: options.active }),
      ...(options.completionTime === undefined
        ? {}
        : { completionTime: new Date(options.completionTime) }),
      ...(options.condition === undefined
        ? {}
        : {
            conditions: [
              model(V1JobCondition, {
                type: options.condition,
                status: "True",
              }),
            ],
          }),
    }),
  });
}

function makeDeploymentDetail(options: {
  id: string;
  status?: string;
  recoveryRequired?: boolean;
  handoffAt?: string | null;
  activeDeploymentId?: string | null;
  recoveryIntents?: unknown[];
  contentRecoveries?: unknown[];
  platformRecoveries?: unknown[];
}) {
  return {
    deployment: {
      id: options.id,
      status: options.status ?? "succeeded",
      recoveryRequired: options.recoveryRequired ?? false,
      handoffAt: options.handoffAt ?? null,
    },
    environment: {
      activeDeploymentId: options.activeDeploymentId ?? null,
    },
    recoveryIntents: options.recoveryIntents ?? [],
    contentRecoveries: options.contentRecoveries ?? [],
    platformRecoveries: options.platformRecoveries ?? [],
    minecraftRecoveries: [],
  };
}

describe("classifyDeliveryJobCandidate", () => {
  it("rejects active, Kueue-suspended, deleting, unannotated, and foreign-namespace Jobs", () => {
    expect(
      classifyDeliveryJobCandidate(
        makeJob({
          name: "job-running",
          deploymentId: "dep-1",
          condition: "Complete",
          active: 1,
        }),
        DELIVERY_WORKER_JOBS_NAMESPACE,
      ),
    ).toBeUndefined();

    expect(
      classifyDeliveryJobCandidate(
        makeJob({
          name: "job-suspended",
          deploymentId: "dep-1",
          condition: "Suspended",
          active: 0,
        }),
        DELIVERY_WORKER_JOBS_NAMESPACE,
      ),
    ).toBeUndefined();

    expect(
      classifyDeliveryJobCandidate(
        makeJob({
          name: "job-deleting",
          deploymentId: "dep-1",
          condition: "Complete",
          deleting: true,
        }),
        DELIVERY_WORKER_JOBS_NAMESPACE,
      ),
    ).toBeUndefined();

    expect(
      classifyDeliveryJobCandidate(
        makeJob({ name: "job-no-annotation", condition: "Complete" }),
        DELIVERY_WORKER_JOBS_NAMESPACE,
      ),
    ).toBeUndefined();

    expect(
      classifyDeliveryJobCandidate(
        makeJob({
          name: "job-wrong-ns",
          namespace: DELIVERY_PLATFORM_JOBS_NAMESPACE,
          deploymentId: "dep-1",
          condition: "Complete",
        }),
        DELIVERY_WORKER_JOBS_NAMESPACE,
      ),
    ).toBeUndefined();
  });
});

describe("isDeploymentSettledForJobReap", () => {
  it("rejects non-terminal, recoveryRequired, handed-off, active, pending-intent, and unrestored-barrier deployments", () => {
    expect(
      isDeploymentSettledForJobReap(
        "dep-running",
        makeDeploymentDetail({ id: "dep-running", status: "running" }),
      ),
    ).toBe(false);
    expect(
      isDeploymentSettledForJobReap(
        "dep-recovery",
        makeDeploymentDetail({
          id: "dep-recovery",
          status: "failed",
          recoveryRequired: true,
        }),
      ),
    ).toBe(false);
    expect(
      isDeploymentSettledForJobReap(
        "dep-handoff",
        makeDeploymentDetail({
          id: "dep-handoff",
          status: "succeeded",
          handoffAt: "2026-11-17T00:00:00.000Z",
        }),
      ),
    ).toBe(false);
    expect(
      isDeploymentSettledForJobReap(
        "dep-active",
        makeDeploymentDetail({
          id: "dep-active",
          status: "succeeded",
          activeDeploymentId: "dep-active",
        }),
      ),
    ).toBe(false);
    expect(
      isDeploymentSettledForJobReap(
        "dep-pending-v2",
        makeDeploymentDetail({
          id: "dep-pending-v2",
          status: "failed",
          recoveryIntents: [{ outcome: "pending", settledAt: null }],
        }),
      ),
    ).toBe(false);
    expect(
      isDeploymentSettledForJobReap(
        "dep-pending-v1",
        makeDeploymentDetail({
          id: "dep-pending-v1",
          status: "failed",
          platformRecoveries: [{ status: "pending" }],
        }),
      ),
    ).toBe(false);
    expect(
      isDeploymentSettledForJobReap(
        "dep-unrestored-barrier",
        makeDeploymentDetail({
          id: "dep-unrestored-barrier",
          status: "failed",
          contentRecoveries: [
            {
              status: "succeeded",
              dispatchBarrier: { deploymentUID: "uid-1" },
              barrierRestoredAt: null,
            },
          ],
        }),
      ),
    ).toBe(false);
    expect(isDeploymentSettledForJobReap("dep-missing-intents", {})).toBe(
      false,
    );
  });

  it("accepts terminal succeeded, failed, and canceled deployments with settled recovery intents and restored barriers", () => {
    for (const status of ["succeeded", "failed", "canceled"]) {
      expect(
        isDeploymentSettledForJobReap(
          `dep-${status}`,
          makeDeploymentDetail({
            id: `dep-${status}`,
            status,
            recoveryRequired: false,
            recoveryIntents: [
              {
                outcome: "succeeded",
                settledAt: "2026-11-10T01:00:00.000Z",
              },
            ],
            contentRecoveries: [
              {
                status: "succeeded",
                dispatchBarrier: { deploymentUID: "uid-1" },
                barrierRestoredAt: "2026-11-10T01:05:00.000Z",
              },
            ],
          }),
        ),
      ).toBe(true);
    }
  });
});

describe("reapSettledDeliveryJobs", () => {
  it("never deletes active, recoveryRequired, pending-intent, or lookup-failed Jobs", async () => {
    const deleteCalls: unknown[] = [];
    const inspectCalls: string[] = [];
    const details = new Map<string, unknown>([
      [
        "dep-recovery-required",
        makeDeploymentDetail({
          id: "dep-recovery-required",
          status: "failed",
          recoveryRequired: true,
        }),
      ],
      [
        "dep-pending-intent",
        makeDeploymentDetail({
          id: "dep-pending-intent",
          status: "failed",
          recoveryRequired: false,
          recoveryIntents: [{ outcome: "pending", settledAt: null }],
        }),
      ],
    ]);

    const result = await reapSettledDeliveryJobs({
      namespace: DELIVERY_WORKER_JOBS_NAMESPACE,
      jobs: {
        listNamespacedJob: vi.fn(() =>
          Promise.resolve({
            items: [
              makeJob({
                name: "job-active",
                deploymentId: "dep-active",
                condition: "Complete",
                active: 1,
              }),
              makeJob({
                name: "job-queued-suspended",
                deploymentId: "dep-queued",
                condition: "Suspended",
                active: 0,
              }),
              makeJob({
                name: "job-recovery-required",
                deploymentId: "dep-recovery-required",
                condition: "Failed",
                completionTime: "2026-11-01T01:00:00Z",
              }),
              makeJob({
                name: "job-pending-intent",
                deploymentId: "dep-pending-intent",
                condition: "Failed",
                completionTime: "2026-11-01T02:00:00Z",
              }),
              makeJob({
                name: "job-lookup-404",
                deploymentId: "platform/intent-not-a-deployment",
                condition: "Complete",
                completionTime: "2026-11-01T03:00:00Z",
              }),
              makeJob({
                name: "job-lookup-503",
                deploymentId: "dep-api-down",
                condition: "Complete",
                completionTime: "2026-11-01T04:00:00Z",
              }),
            ],
          }),
        ),
        deleteNamespacedJob: vi.fn((request: unknown) => {
          deleteCalls.push(request);
          return Promise.resolve({});
        }),
      },
      inspectDeployment: (deploymentId) => {
        inspectCalls.push(deploymentId);
        if (deploymentId === "platform/intent-not-a-deployment") {
          return Promise.reject(new Error("Delivery API returned HTTP 404"));
        }
        if (deploymentId === "dep-api-down") {
          return Promise.reject(new Error("Delivery API is unreachable"));
        }
        const detail = details.get(deploymentId);
        return detail === undefined
          ? Promise.reject(new Error(`Unexpected lookup ${deploymentId}`))
          : Promise.resolve(detail);
      },
    });

    expect(result).toEqual({
      namespace: DELIVERY_WORKER_JOBS_NAMESPACE,
      scanned: 6,
      candidates: 4,
      deleted: [],
      skippedUnsettled: 4,
    });
    expect(inspectCalls).toEqual([
      "dep-recovery-required",
      "dep-pending-intent",
      "platform/intent-not-a-deployment",
      "dep-api-down",
    ]);
    expect(deleteCalls).toEqual([]);
  });
});

describe("reapSettledDeliveryJobs settled deletion and bounds", () => {
  it("deletes settled succeeded, failed, and canceled Jobs with propagationPolicy Background and deduplicates lookups", async () => {
    const deleteCalls: unknown[] = [];
    const inspectCalls: string[] = [];
    const details = new Map<string, unknown>([
      [
        "dep-settled-failed",
        makeDeploymentDetail({
          id: "dep-settled-failed",
          status: "failed",
          recoveryRequired: false,
          recoveryIntents: [
            { outcome: "succeeded", settledAt: "2026-11-02T00:00:00.000Z" },
          ],
        }),
      ],
      [
        "dep-settled-succeeded",
        makeDeploymentDetail({
          id: "dep-settled-succeeded",
          status: "succeeded",
          recoveryRequired: false,
        }),
      ],
      [
        "dep-settled-canceled",
        makeDeploymentDetail({
          id: "dep-settled-canceled",
          status: "canceled",
          recoveryRequired: false,
        }),
      ],
    ]);

    const result = await reapSettledDeliveryJobs({
      namespace: DELIVERY_WORKER_JOBS_NAMESPACE,
      jobs: {
        listNamespacedJob: () =>
          Promise.resolve({
            items: [
              makeJob({
                name: "job-settled-failed",
                uid: "uid-settled-failed",
                deploymentId: "dep-settled-failed",
                condition: "Failed",
                completionTime: "2026-11-01T00:30:00Z",
              }),
              makeJob({
                name: "job-settled-succeeded-a",
                uid: "uid-settled-a",
                deploymentId: "dep-settled-succeeded",
                condition: "Complete",
                completionTime: "2026-11-01T05:00:00Z",
              }),
              makeJob({
                name: "job-settled-succeeded-b",
                uid: "uid-settled-b",
                deploymentId: "dep-settled-succeeded",
                condition: "Complete",
                completionTime: "2026-11-01T06:00:00Z",
              }),
              makeJob({
                name: "job-settled-canceled",
                uid: "uid-settled-canceled",
                deploymentId: "dep-settled-canceled",
                condition: "Failed",
                completionTime: "2026-11-01T07:00:00Z",
              }),
            ],
          }),
        deleteNamespacedJob: (request) => {
          deleteCalls.push(request);
          return Promise.resolve({});
        },
      },
      inspectDeployment: (deploymentId) => {
        inspectCalls.push(deploymentId);
        const detail = details.get(deploymentId);
        return detail === undefined
          ? Promise.reject(new Error(`Unexpected lookup ${deploymentId}`))
          : Promise.resolve(detail);
      },
    });

    expect(result.deleted).toEqual([
      "job-settled-failed",
      "job-settled-succeeded-a",
      "job-settled-succeeded-b",
      "job-settled-canceled",
    ]);
    expect(inspectCalls).toEqual([
      "dep-settled-failed",
      "dep-settled-succeeded",
      "dep-settled-canceled",
    ]);
    expect(deleteCalls).toEqual([
      {
        namespace: DELIVERY_WORKER_JOBS_NAMESPACE,
        name: "job-settled-failed",
        propagationPolicy: "Background",
        body: { preconditions: { uid: "uid-settled-failed" } },
      },
      {
        namespace: DELIVERY_WORKER_JOBS_NAMESPACE,
        name: "job-settled-succeeded-a",
        propagationPolicy: "Background",
        body: { preconditions: { uid: "uid-settled-a" } },
      },
      {
        namespace: DELIVERY_WORKER_JOBS_NAMESPACE,
        name: "job-settled-succeeded-b",
        propagationPolicy: "Background",
        body: { preconditions: { uid: "uid-settled-b" } },
      },
      {
        namespace: DELIVERY_WORKER_JOBS_NAMESPACE,
        name: "job-settled-canceled",
        propagationPolicy: "Background",
        body: { preconditions: { uid: "uid-settled-canceled" } },
      },
    ]);
  });
});

describe("reapSettledDeliveryJobs sweep bounds", () => {
  it.each<DeliveryJobReaperNamespace>([
    DELIVERY_WORKER_JOBS_NAMESPACE,
    DELIVERY_PLATFORM_JOBS_NAMESPACE,
  ])(
    "bounds per-sweep candidates oldest-first and advances past retained unsettled prefixes in %s",
    async (namespace) => {
      const deleted: string[] = [];
      const result = await reapSettledDeliveryJobs({
        namespace,
        maxCandidates: 2,
        sweepIndex: 0,
        jobs: {
          listNamespacedJob: () =>
            Promise.resolve({
              items: [
                makeJob({
                  name: "job-3",
                  namespace,
                  deploymentId: "dep-1",
                  condition: "Complete",
                  completionTime: "2026-11-03T00:00:00Z",
                }),
                makeJob({
                  name: "job-1",
                  namespace,
                  deploymentId: "dep-1",
                  condition: "Complete",
                  completionTime: "2026-11-01T00:00:00Z",
                }),
                makeJob({
                  name: "job-2",
                  namespace,
                  deploymentId: "dep-1",
                  condition: "Complete",
                  completionTime: "2026-11-02T00:00:00Z",
                }),
              ],
            }),
          deleteNamespacedJob: ({ name }) => {
            deleted.push(name);
            return Promise.resolve({});
          },
        },
        inspectDeployment: () =>
          Promise.resolve(
            makeDeploymentDetail({ id: "dep-1", status: "succeeded" }),
          ),
      });

      expect(result.candidates).toBe(2);
      expect(deleted).toEqual(["job-1", "job-2"]);

      const retainedPrefix = Array.from({ length: 100 }, (_, index) =>
        makeJob({
          name: `retained-${String(index).padStart(3, "0")}`,
          namespace,
          deploymentId: "dep-retained",
          condition: "Failed",
          completionTime: `2026-10-01T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}Z`,
        }),
      );
      const settledTail = makeJob({
        name: "settled-100",
        namespace,
        deploymentId: "dep-settled",
        condition: "Complete",
        completionTime: "2026-11-15T00:00:00Z",
      });
      const tailDeleted: string[] = [];
      for (const sweepIndex of [0, 1]) {
        await reapSettledDeliveryJobs({
          namespace,
          maxCandidates: 100,
          sweepIndex,
          jobs: {
            listNamespacedJob: () =>
              Promise.resolve({ items: [...retainedPrefix, settledTail] }),
            deleteNamespacedJob: ({ name }) => {
              tailDeleted.push(name);
              return Promise.resolve({});
            },
          },
          inspectDeployment: (deploymentId) =>
            Promise.resolve(
              makeDeploymentDetail({
                id: deploymentId,
                status: deploymentId === "dep-settled" ? "succeeded" : "failed",
                recoveryRequired: deploymentId !== "dep-settled",
              }),
            ),
        });
      }
      expect(tailDeleted).toEqual(["settled-100"]);
    },
  );
});
