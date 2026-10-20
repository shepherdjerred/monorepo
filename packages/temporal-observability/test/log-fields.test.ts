import { describe, expect, test } from "vitest";
import {
  isSensitiveTemporalLogField,
  sanitizeTemporalLogFields,
  serializeLogError,
  serializeLogErrorFields,
} from "@shepherdjerred/temporal-observability/log-fields";

describe("Temporal log field safety", () => {
  test.each([
    "taskToken",
    "authorization",
    "api_key",
    "workflow.payload",
    "reportBody",
    "player-data",
    "systemPrompt",
    "activityArgs",
    "activityResult",
  ])("rejects %s", (field) => {
    expect(isSensitiveTemporalLogField(field)).toBe(true);
  });

  test("keeps safe execution context without reading sensitive values", () => {
    const fields = sanitizeTemporalLogFields({
      activityType: "refresh",
      taskQueue: "reports",
      workflowId: "report-refresh-2026-08-28",
      taskToken: "must-not-escape",
      reportBody: "must-not-escape",
    });

    expect(fields).toEqual({
      activityType: "refresh",
      taskQueue: "reports",
      workflowId: "report-refresh-2026-08-28",
    });
  });
});

describe("Temporal log error serialization", () => {
  test("keeps the name, message, stack and cause chain of an Error", () => {
    const root = new TypeError("socket closed");
    const failure = new Error("Activity task failed", { cause: root });

    const serialized = serializeLogError(failure);

    expect(serialized).toMatchObject({
      name: "Error",
      message: "Activity task failed",
      cause: { name: "TypeError", message: "socket closed" },
    });
    expect(serialized.stack).toContain("Activity task failed");
    expect(JSON.stringify(serialized)).toContain('"message":"socket closed"');
  });

  test("serializes DOMException", () => {
    const aborted = new DOMException(
      "The operation was aborted.",
      "AbortError",
    );

    expect(serializeLogError(aborted)).toMatchObject({
      name: "AbortError",
      message: "The operation was aborted.",
    });
  });

  test("records only the kind of a non-Error cause and bounds cycles", () => {
    const payloadCause = new Error("rejected", {
      cause: { taskToken: "must-not-escape" },
    });
    expect(serializeLogError(payloadCause).cause).toBe("[object]");

    const cyclic = new Error("loop");
    cyclic.cause = cyclic;
    const serialized = JSON.stringify(serializeLogError(cyclic));
    expect(serialized).toContain('"message":"loop"');
    expect(serialized).not.toContain("must-not-escape");
  });

  test("replaces top-level Error fields and leaves other values alone", () => {
    const fields = serializeLogErrorFields({
      activityType: "refresh",
      attempt: 2,
      error: new Error("upstream returned 503"),
    });

    expect(fields["activityType"]).toBe("refresh");
    expect(fields["attempt"]).toBe(2);
    expect(JSON.stringify(fields)).toContain("upstream returned 503");
  });
});
