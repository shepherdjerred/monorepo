import { describe, expect, it } from "vitest";

import { CancelIncidentArgsSchema } from "#shared/cancel-incident-args";

describe("cancel-incident CLI arguments", () => {
  const base = {
    database: "file:/data/alert-dashboard.db",
    from: "2026-08-30T16:00:00Z",
    to: "2026-08-30T17:00:00Z",
    operator: "operator",
    reason: "a sufficiently descriptive reason",
    confirm: false,
  };

  it("targets the documented incident when no alertname is given", () => {
    // README.md's reviewed command omits --alertname. Widening that by
    // omission is how an operator cancels notifications they never meant to
    // touch, so the default has to stay the narrow one.
    const args = CancelIncidentArgsSchema.parse({
      ...base,
      allAlertnames: false,
    });
    expect(args.alertname).toBe("TemporalWorkflowFailed");
    expect(args.allAlertnames).toBe(false);
  });

  it("refuses to combine an explicit alertname with every alertname", () => {
    expect(() =>
      CancelIncidentArgsSchema.parse({
        ...base,
        alertname: "SomethingElse",
        allAlertnames: true,
      }),
    ).toThrow(/cannot be combined/u);
  });
});
