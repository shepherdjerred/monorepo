import { describe, expect, test } from "vitest";
import {
  ScoutWorkflowStartRecordSchema,
  ScoutWorkflowStartRequestSchema,
  WORKFLOW_START_LIFECYCLE,
  WORKFLOW_START_PHASES,
  workflowStartLifecycle,
  workflowStartPhase,
} from "#src/recovery/workflow-start.ts";
import {
  acceptedRecord,
  requestedRecord,
  startRequest,
} from "#src/recovery/workflow-start.test-fixtures.ts";

describe("ScoutWorkflowStartRequestSchema", () => {
  test("accepts a request whose envelope kind is its workflow type", () => {
    expect(ScoutWorkflowStartRequestSchema.parse(startRequest())).toEqual(
      startRequest(),
    );
  });

  test("rejects an envelope whose kind is not the workflow type", () => {
    expect(() =>
      ScoutWorkflowStartRequestSchema.parse(
        startRequest({
          inputPayload: { kind: "hall-baseline", version: 1, data: {} },
        }),
      ),
    ).toThrow(/does not match workflowType/u);
  });

  test("rejects an input that is not a versioned envelope", () => {
    expect(() =>
      ScoutWorkflowStartRequestSchema.parse({
        ...startRequest(),
        inputPayload: { nope: true },
      }),
    ).toThrow();
  });
});

describe("ScoutWorkflowStartRecordSchema", () => {
  test("round-trips a requested and an accepted record", () => {
    expect(ScoutWorkflowStartRecordSchema.parse(requestedRecord())).toEqual(
      requestedRecord(),
    );
    expect(ScoutWorkflowStartRecordSchema.parse(acceptedRecord())).toEqual(
      acceptedRecord(),
    );
  });

  test("rejects a request key that is not a lowercase UUID", () => {
    expect(() =>
      ScoutWorkflowStartRecordSchema.parse({
        ...requestedRecord(),
        requestId: "6F1E7F1A-2B3C-4D5E-8F90-0123456789AB",
      }),
    ).toThrow(/requestId/u);
    expect(() =>
      ScoutWorkflowStartRecordSchema.parse({
        ...requestedRecord(),
        requestId: "wf-1",
      }),
    ).toThrow(/requestId/u);
  });

  test("applies the expected-kind contract to records too", () => {
    expect(() =>
      ScoutWorkflowStartRecordSchema.parse(
        requestedRecord({
          inputPayload: { kind: "hall-baseline", version: 1, data: {} },
        }),
      ),
    ).toThrow(/does not match workflowType/u);
  });
});

describe("lifecycle table", () => {
  test("names every phase exactly once", () => {
    expect(Object.keys(WORKFLOW_START_LIFECYCLE).sort()).toEqual(
      [...WORKFLOW_START_PHASES].sort(),
    );
  });

  test("a requested record is in flight; an accepted one is terminal", () => {
    expect(workflowStartPhase(requestedRecord())).toBe("requested");
    expect(workflowStartLifecycle(requestedRecord())).toBe("in-flight");
    expect(workflowStartPhase(acceptedRecord())).toBe("accepted");
    expect(workflowStartLifecycle(acceptedRecord())).toBe("terminal");
  });

  test("acceptance without a run id is still terminal", () => {
    expect(workflowStartLifecycle(acceptedRecord({ runId: null }))).toBe(
      "terminal",
    );
  });
});
