import { expect, test } from "vitest";
import type { MediaAutomationContext } from "#automation/context.ts";
import { observeMovieRollbackClosedOwnerV1 } from "./closed-owner.ts";

const operationId = "c88ca5d0-7801-482e-af21-40d11352b3c8";
const sourceId = "64718411-89f6-49d0-8a91-8d720176af03";
const attemptId = "463bbdd4-ed86-48fb-b212-a90679572681";
// This boundary reads only these fields; no fixture below writes persisted
// admission, SDK or terminal status records.
const manual = {
  operationId,
  owner: {
    workflowId: `media-operation-${operationId}`,
    runId: "actual-original-run",
    activityId: "admission",
  },
  invocation: {
    mode: "manual_verified",
    source: {
      schemaVersion: 4,
      operationId: sourceId,
      attemptId,
      scope: {
        mediaId: "79dd1a7f-b45b-4fc9-adc3-37e3620c6f30",
        rootMediaId: "79dd1a7f-b45b-4fc9-adc3-37e3620c6f30",
        edition: "directors_cut",
      },
    },
  },
} as const;
const automatic = {
  ...manual,
  owner: { ...manual.owner, workflowId: `media-acquire-${attemptId}` },
  invocation: {
    mode: "automatic_failed_plex",
    source: manual.invocation.source,
  },
} as const;
const execution = {
  assertActive() {
    // This unit capability stays active; expiry has its own test below.
  },
};
type Describe = MediaAutomationContext["describeWorkflow"];
const unavailableDescribe: Describe = () =>
  Promise.reject(new Error("Unavailable"));

test.each([null, { runId: "different-run", status: "TERMINATED" }] as const)(
  "missing or substituted terminal owner cannot grant a handoff: %j",
  async (observed) => {
    expect(
      await observeMovieRollbackClosedOwnerV1(
        () => Promise.resolve(observed),
        manual,
        { execution },
      ),
    ).toEqual({ state: "unknown" });
  },
);

test("an unavailable description remains unknown and never implies a closed executor", async () => {
  expect(
    await observeMovieRollbackClosedOwnerV1(unavailableDescribe, manual, {
      execution,
    }),
  ).toEqual({ state: "unknown" });
});

test("expiration while an unavailable description settles still fails the original capability", async () => {
  let expired = false;
  const failure = new Error("original SDK deadline expired");
  await expect(
    observeMovieRollbackClosedOwnerV1(
      () => {
        expired = true;
        return Promise.reject(new Error("Unavailable"));
      },
      manual,
      {
        execution: {
          assertActive() {
            if (expired) throw failure;
          },
        },
      },
    ),
  ).rejects.toBe(failure);
});

test.each(["RUNNING", "TERMINATED"] as const)(
  "automatic recovery requires its exact child and a confirmed closed source root: %s",
  async (status) => {
    const calls: string[] = [];
    const describe: Describe = (workflowId) => {
      calls.push(workflowId);
      return Promise.resolve({
        runId:
          workflowId === automatic.owner.workflowId
            ? automatic.owner.runId
            : "actual-source-root-run",
        status,
      });
    };
    const result = await observeMovieRollbackClosedOwnerV1(
      describe,
      automatic,
      { execution },
    );
    expect(result.state).toBe(status === "RUNNING" ? "running" : "closed");
    expect(calls).toEqual(
      status === "RUNNING"
        ? [automatic.owner.workflowId]
        : [automatic.owner.workflowId, `media-operation-${sourceId}`],
    );
    if (result.state === "closed")
      expect(result.sourceRoot).toEqual({
        workflowId: `media-operation-${sourceId}`,
        runId: "actual-source-root-run",
        status: "TERMINATED",
      });
  },
);

test("a terminal automatic child does not permit takeover while its source coordinator is unavailable", async () => {
  const describe: Describe = (workflowId) =>
    workflowId === automatic.owner.workflowId
      ? Promise.resolve({ runId: automatic.owner.runId, status: "FAILED" })
      : Promise.reject(new Error("Unavailable"));
  expect(
    await observeMovieRollbackClosedOwnerV1(describe, automatic, { execution }),
  ).toEqual({ state: "unknown" });
});
