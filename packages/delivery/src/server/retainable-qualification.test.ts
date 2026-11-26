import { describe, expect, test } from "vitest";
import { DeliveryError } from "#domain/error.ts";
import { testExecutor } from "#testing/seed.ts";
import {
  createRetainableQualificationCounters,
  type RetainableQualificationOutcome,
} from "./metrics.ts";
import { createRetainableQualifier } from "./qualification-routes.ts";

function makeBuild(id: string, pipelineNumber: number) {
  return {
    id,
    requestId: `req-${id}`,
    serviceId: "scout-for-lol",
    sourceRevision: "a".repeat(40),
    sourceKind: "ci",
    ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(pipelineNumber)}`,
    verifiedAt: new Date(),
    status: "pending",
    qualificationReason: null,
    qualificationCheckedAt: null,
    platformChanges: null,
    repositoryId: 1,
    pipelineNumber,
    registrationSequence: pipelineNumber,
    createdAt: new Date(),
  };
}

describe("on-read retainable qualification wiring", () => {
  test("memoizes Woodpecker pipeline lookups per request and settles distinct builds", async () => {
    const qualifiedCalls: {
      buildId: string;
      status: RetainableQualificationOutcome;
      reason?: string;
    }[] = [];
    const woodpeckerLookups: string[] = [];
    const counters = createRetainableQualificationCounters();

    const qualifyPending = createRetainableQualifier({
      qualifyInStore: (buildId, status, _actor, reason) => {
        qualifiedCalls.push({
          buildId,
          status,
          ...(reason === undefined ? {} : { reason }),
        });
        return Promise.resolve({ status });
      },
      qualifyBuild: (request) => {
        woodpeckerLookups.push(request.ciUrl);
        return Promise.resolve("failed");
      },
      principal: testExecutor,
      requestId: "req-1",
      recordOutcome: (outcome) => {
        counters.record(outcome);
      },
    });

    const buildA = makeBuild("build-42-a", 42);
    const buildB = makeBuild("build-42-b", 42);
    expect(await qualifyPending(buildA)).toBe("failed");
    expect(await qualifyPending(buildA)).toBe("failed");
    expect(await qualifyPending(buildB)).toBe("failed");

    expect(woodpeckerLookups).toEqual([
      "https://woodpecker.sjer.red/repos/1/pipeline/42",
    ]);
    expect(qualifiedCalls).toEqual([
      { buildId: "build-42-a", status: "failed" },
      { buildId: "build-42-b", status: "failed" },
    ]);
    expect(counters.snapshot()).toEqual({ pending: 0, verified: 0, failed: 2 });
  });

  test("leaves pending builds pending on PAUSED and fails INVALID builds with reason", async () => {
    const qualifiedCalls: {
      buildId: string;
      status: RetainableQualificationOutcome;
      reason?: string;
    }[] = [];
    const counters = createRetainableQualificationCounters();

    const qualifyPending = createRetainableQualifier({
      qualifyInStore: (buildId, status, _actor, reason) => {
        qualifiedCalls.push({
          buildId,
          status,
          ...(reason === undefined ? {} : { reason }),
        });
        return Promise.resolve({ status });
      },
      qualifyBuild: (request) =>
        Promise.reject(
          request.ciUrl.endsWith("/50")
            ? new DeliveryError("PAUSED", "Woodpecker 503 unavailable")
            : new DeliveryError("INVALID", "Pipeline commit mismatch"),
        ),
      principal: testExecutor,
      requestId: "req-2",
      recordOutcome: (outcome) => {
        counters.record(outcome);
      },
    });

    expect(await qualifyPending(makeBuild("paused-build", 50))).toBe("pending");
    expect(await qualifyPending(makeBuild("invalid-build", 51))).toBe("failed");
    expect(qualifiedCalls).toEqual([
      {
        buildId: "invalid-build",
        status: "failed",
        reason: "Pipeline commit mismatch",
      },
    ]);
    expect(counters.snapshot()).toEqual({ pending: 1, verified: 0, failed: 1 });
  });
});
