import { describe, expect, it } from "vitest";
import {
  requireSettlementTask,
  requireSettlementOwner,
  settlementRecoveryPlan,
} from "./settlement-recovery.ts";

const deploymentId = "9837dcf4-2099-4ae5-b078-9ae352d3a4d8";
const runId = "01a15b0b-dae6-739e-8a97-f520a3798728";
function input() {
  return {
    deploymentId,
    runId,
    activityId: "3",
    workflowType: "deliveryDeploymentWorkflow",
    workflowStatus: "RUNNING",
    taskQueue: "delivery-workflows",
    pending: [{ id: "3", type: "finishDelivery", state: 1 }],
    scheduled: [
      {
        id: "3",
        type: "finishDelivery",
        args: [deploymentId, { status: "failed", evidence: [] }],
      },
    ],
  };
}

describe("independent failure settlement", () => {
  it("resumes a committed failure after a lost Activity acknowledgement but never accepts success", () => {
    expect(() =>
      requireSettlementOwner({
        deploymentId,
        status: "failed",
        activeDeploymentId: null,
      }),
    ).not.toThrow();
    expect(() =>
      requireSettlementOwner({
        deploymentId,
        status: "running",
        activeDeploymentId: runId,
      }),
    ).toThrow("ownership changed");
    expect(() =>
      requireSettlementOwner({
        deploymentId,
        status: "succeeded",
        activeDeploymentId: null,
      }),
    ).toThrow("ownership changed");
  });
  it("preserves the recorded failure and creates a resumable private queue", () => {
    const plan = settlementRecoveryPlan(input());
    expect(plan.result).toEqual({ status: "failed", evidence: [] });
    expect(plan.queue).toBe(`delivery-settlement/${runId}/3`);
    expect(() =>
      requireSettlementTask(
        plan,
        { workflowId: `delivery/${deploymentId}`, runId, activityId: "3" },
        deploymentId,
        plan.result,
      ),
    ).not.toThrow();
  });
  it("refuses a successful result even if it appears in history", () => {
    const value = input();
    value.scheduled = [
      {
        id: "3",
        type: "finishDelivery",
        args: [deploymentId, { status: "succeeded", evidence: [] }],
      },
    ];
    expect(() => settlementRecoveryPlan(value)).toThrow("cannot manufacture");
  });
  it.each(["applyDelivery", "verifyDelivery", "executeDeliveryPlatform"])(
    "cannot take over %s",
    (type) => {
      const value = input();
      value.pending = [{ id: "3", type, state: 1 }];
      expect(() => settlementRecoveryPlan(value)).toThrow("exact scheduled");
    },
  );
  it("refuses an executing Activity, additional pending work, or a closed run", () => {
    expect(() =>
      settlementRecoveryPlan({
        ...input(),
        pending: [{ id: "3", type: "finishDelivery", state: 2 }],
      }),
    ).toThrow();
    expect(() =>
      settlementRecoveryPlan({
        ...input(),
        pending: [
          ...input().pending,
          { id: "4", type: "applyDelivery", state: 1 },
        ],
      }),
    ).toThrow();
    expect(() =>
      settlementRecoveryPlan({ ...input(), workflowStatus: "COMPLETED" }),
    ).toThrow();
  });
  it("refuses foreign history and changed task inputs", () => {
    const value = input();
    value.scheduled = [
      {
        id: "3",
        type: "finishDelivery",
        args: [runId, { status: "failed", evidence: [] }],
      },
    ];
    expect(() => settlementRecoveryPlan(value)).toThrow("history differs");
    const plan = settlementRecoveryPlan(input());
    expect(() =>
      requireSettlementTask(
        plan,
        {
          workflowId: `delivery/${deploymentId}`,
          runId: deploymentId,
          activityId: "3",
        },
        deploymentId,
        plan.result,
      ),
    ).toThrow();
    expect(() =>
      requireSettlementTask(
        plan,
        { workflowId: `delivery/${deploymentId}`, runId, activityId: "3" },
        deploymentId,
        { status: "canceled", evidence: [] },
      ),
    ).toThrow();
  });
});
