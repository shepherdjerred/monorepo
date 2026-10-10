import { z } from "zod/v4";
import type { ActivityReportInput } from "#activities/reports/report-delivery.ts";

export const NotificationCanaryInputSchema = z.strictObject({
  condition: z.enum(["attention", "clear"]),
});
export type NotificationCanaryInput = z.infer<
  typeof NotificationCanaryInputSchema
>;

export function notificationCanaryReport(
  raw: NotificationCanaryInput,
  observedAt: string,
): ActivityReportInput {
  const { condition } = NotificationCanaryInputSchema.parse(raw);
  return {
    reportType: "daily-notification-policy-canary",
    scheduleId: "daily-notification-policy-canary",
    title: "Beta notification policy canary",
    startedAt: observedAt,
    execution: "complete",
    verdict: condition,
    headline: `Beta notification canary: ${condition}. This is an explicit delivery rehearsal.`,
    checks: [
      {
        id: "canary-input",
        label: "Canary input validated",
        required: true,
        status: "passed",
        summary: `Validated canary condition ${condition}.`,
        evidenceReceiptIds: ["canary-input"],
      },
    ],
    evidence: [
      {
        id: "canary-input",
        source: "Explicit beta canary input",
        observedAt,
        status: "success",
        excerpt: JSON.stringify({ condition }),
      },
    ],
    findings:
      condition === "attention"
        ? [
            {
              id: "notification-canary-condition",
              state: "active",
              severity: "warning",
              summary: "Rehearsal attention condition",
              evidenceReceiptIds: ["canary-input"],
            },
          ]
        : [],
    limitations: [
      "Synthetic canary input; this does not assess production health.",
    ],
    actions: [],
    provenance: { source: "Beta notification policy rehearsal" },
  };
}
