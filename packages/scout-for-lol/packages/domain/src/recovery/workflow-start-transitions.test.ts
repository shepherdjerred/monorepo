import { describe, expect, test } from "vitest";
import { IsoInstantSchema, WorkflowRunIdSchema } from "#src/identity/brands.ts";
import {
  acceptWorkflowStart,
  decideWorkflowStartRequest,
  sameWorkflowStartIdentity,
} from "#src/recovery/workflow-start-transitions.ts";
import {
  ACCEPTED_AT,
  RUN_ID,
  SECOND_REQUEST_ID,
  acceptedRecord,
  requestedRecord,
  startRequest,
} from "#src/recovery/workflow-start.test-fixtures.ts";

const EMPTY = { inFlight: null, latestAccepted: null };

describe("sameWorkflowStartIdentity", () => {
  test("ignores who asked, where from, and when", () => {
    const a = startRequest();
    const b = {
      ...startRequest({ requestSource: "test:elsewhere" }),
      requestedBy: null,
      requestedAt: ACCEPTED_AT,
    };
    expect(sameWorkflowStartIdentity(a, b)).toBe(true);
  });

  test("compares the input structurally, whatever the key order", () => {
    const reordered = startRequest({
      inputPayload: {
        kind: startRequest().workflowType,
        version: 1,
        data: { trigger: "operator", stage: "beta" },
      },
    });
    expect(sameWorkflowStartIdentity(startRequest(), reordered)).toBe(true);
  });

  test("a different input or type is a different start", () => {
    expect(
      sameWorkflowStartIdentity(
        startRequest(),
        startRequest({
          inputPayload: {
            kind: startRequest().workflowType,
            version: 1,
            data: { stage: "beta", trigger: "schedule" },
          },
        }),
      ),
    ).toBe(false);
    expect(
      sameWorkflowStartIdentity(
        startRequest(),
        startRequest({
          workflowType: "other",
          inputPayload: { kind: "other", version: 1, data: {} },
        }),
      ),
    ).toBe(false);
  });

  test("a different envelope version is a different start", () => {
    expect(
      sameWorkflowStartIdentity(
        startRequest(),
        startRequest({
          inputPayload: { ...startRequest().inputPayload, version: 2 },
        }),
      ),
    ).toBe(false);
  });
});

describe("decideWorkflowStartRequest", () => {
  test("nothing recorded: record the request", () => {
    expect(decideWorkflowStartRequest(EMPTY, startRequest())).toEqual({
      outcome: "record",
    });
  });

  test("an in-flight request for the same start is adopted", () => {
    const inFlight = requestedRecord();
    expect(
      decideWorkflowStartRequest(
        { inFlight, latestAccepted: null },
        startRequest({ requestSource: "test:retry" }),
      ),
    ).toEqual({ outcome: "adopt", record: inFlight });
  });

  test("an in-flight request wins over an accepted predecessor", () => {
    // Both exist: a request accepted last week, and one in flight now. The
    // in-flight one is what a concurrent requester must join.
    const inFlight = requestedRecord({ requestId: SECOND_REQUEST_ID });
    expect(
      decideWorkflowStartRequest(
        { inFlight, latestAccepted: acceptedRecord() },
        startRequest(),
      ),
    ).toEqual({ outcome: "adopt", record: inFlight });
  });

  test("an accepted predecessor is terminal: record a new request", () => {
    expect(
      decideWorkflowStartRequest(
        { inFlight: null, latestAccepted: acceptedRecord() },
        startRequest(),
      ),
    ).toEqual({ outcome: "record" });
  });

  test("a different start under the same id conflicts, in flight or terminal", () => {
    const differing = startRequest({
      inputPayload: {
        kind: startRequest().workflowType,
        version: 1,
        data: { stage: "beta", trigger: "schedule" },
      },
    });
    expect(
      decideWorkflowStartRequest(
        { inFlight: requestedRecord(), latestAccepted: null },
        differing,
      ),
    ).toEqual({ outcome: "conflict", reason: "request-differs" });
    expect(
      decideWorkflowStartRequest(
        { inFlight: null, latestAccepted: acceptedRecord() },
        differing,
      ),
    ).toEqual({ outcome: "conflict", reason: "request-differs" });
  });

  test("refuses a context that belongs to another Workflow id", () => {
    expect(() =>
      decideWorkflowStartRequest(
        {
          inFlight: requestedRecord({ requestedWorkflowId: "other-id" }),
          latestAccepted: null,
        },
        startRequest(),
      ),
    ).toThrow(/belongs to other-id/u);
    expect(() =>
      decideWorkflowStartRequest(
        {
          inFlight: null,
          latestAccepted: acceptedRecord({ requestedWorkflowId: "other-id" }),
        },
        startRequest(),
      ),
    ).toThrow(/belongs to other-id/u);
  });

  test("refuses a context whose phases are mislabelled", () => {
    expect(() =>
      decideWorkflowStartRequest(
        { inFlight: acceptedRecord(), latestAccepted: null },
        startRequest(),
      ),
    ).toThrow(/offered as in flight is accepted/u);
    expect(() =>
      decideWorkflowStartRequest(
        { inFlight: null, latestAccepted: requestedRecord() },
        startRequest(),
      ),
    ).toThrow(/offered as accepted is unaccepted/u);
  });
});

describe("acceptWorkflowStart", () => {
  const acceptance = { acceptedAt: ACCEPTED_AT, runId: RUN_ID };

  test("accepts a requested record", () => {
    expect(acceptWorkflowStart(requestedRecord(), acceptance)).toEqual({
      outcome: "applied",
      next: acceptedRecord(),
    });
  });

  test("the identical acceptance replays idempotently", () => {
    expect(acceptWorkflowStart(acceptedRecord(), acceptance)).toEqual({
      outcome: "already-applied",
    });
  });

  test("an equal instant spelled differently is still the same acceptance", () => {
    expect(
      acceptWorkflowStart(acceptedRecord(), {
        ...acceptance,
        acceptedAt: IsoInstantSchema.parse("2026-09-16T10:00:01Z"),
      }),
    ).toEqual({ outcome: "already-applied" });
  });

  test("a different run id or instant conflicts", () => {
    expect(
      acceptWorkflowStart(acceptedRecord(), {
        ...acceptance,
        runId: WorkflowRunIdSchema.parse("run-2"),
      }),
    ).toEqual({ outcome: "conflict", reason: "acceptance-differs" });
    expect(
      acceptWorkflowStart(acceptedRecord({ runId: null }), acceptance),
    ).toEqual({ outcome: "conflict", reason: "acceptance-differs" });
  });
});
