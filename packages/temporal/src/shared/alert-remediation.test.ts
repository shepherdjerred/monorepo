import { describe, expect, it } from "bun:test";
import {
  alertRemediationWorkflowId,
  sanitizeAlertIdPart,
} from "./alert-remediation.ts";

describe("alert remediation shared helpers", () => {
  it("sanitizes alert fingerprint parts for Temporal ids and branches", () => {
    expect(sanitizeAlertIdPart("Bugsink:Scout Prod:abc-123")).toBe(
      "bugsink-scout-prod-abc-123",
    );
  });

  it("builds stable child workflow ids from source and fingerprint", () => {
    expect(
      alertRemediationWorkflowId({
        source: "pagerduty",
        fingerprint: "pagerduty:P123",
        title: "PVC storage high",
        status: "triggered",
        severity: "high",
        url: "https://example.com/incidents/P123",
        details: {},
      }),
    ).toBe("alert-remediation/pagerduty/pagerduty-p123");
  });
});
