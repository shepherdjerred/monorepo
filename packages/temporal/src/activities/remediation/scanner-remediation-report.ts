import type { ReportRemediationV1 } from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import type { ActivityReportInput } from "#activities/reports/report-delivery.ts";

export function buildScannerRemediationArtifacts(input: {
  observedAt: string;
  remediation: ReportRemediationV1 | undefined;
  checkId: string;
  checkLabel: string;
  receiptId: string;
  receiptSource: string;
}): {
  checks: ActivityReportInput["checks"];
  evidence: ActivityReportInput["evidence"];
} {
  const { remediation } = input;
  if (remediation === undefined) {
    return { checks: [], evidence: [] };
  }
  const failedWithoutPr =
    remediation.outcome === "partial" && remediation.prUrl === undefined;
  const skipped = remediation.outcome === "skipped";
  return {
    checks: [
      {
        id: input.checkId,
        label: input.checkLabel,
        required: false,
        status: skipped ? "skipped" : failedWithoutPr ? "failed" : "passed",
        summary: remediation.summary ?? `Outcome: ${remediation.outcome}`,
        evidenceReceiptIds: skipped ? [] : [input.receiptId],
      },
    ],
    evidence: skipped
      ? []
      : [
          {
            id: input.receiptId,
            source: input.receiptSource,
            observedAt: input.observedAt,
            status: failedWithoutPr ? "failure" : "success",
            ...(remediation.prUrl === undefined
              ? {}
              : { url: remediation.prUrl }),
            excerpt: (remediation.summary ?? remediation.outcome).slice(
              0,
              2000,
            ),
          },
        ],
  };
}
