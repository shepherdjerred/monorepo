import { describe, expect, test } from "vitest";
import {
  isSensitiveTemporalLogField,
  sanitizeTemporalLogFields,
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
