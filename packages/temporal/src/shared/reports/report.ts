import { z } from "zod/v4";

const HttpUrlSchema = z.url({ protocol: /^https?$/ });

export const ReportExecutionSchema = z.enum(["complete", "partial", "failed"]);
export const ReportVerdictSchema = z.enum([
  "clear",
  "changed",
  "attention",
  "pending",
  "inconclusive",
]);
export const ReportCheckStatusSchema = z.enum(["passed", "failed", "skipped"]);
export const ReportEvidenceStatusSchema = z.enum(["success", "failure"]);

export const ReportEvidenceReceiptV1Schema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  // Optional for replay compatibility with receipts recorded before origin
  // was captured. New agent-task receipts always set it.
  origin: z.enum(["provider", "declared-collector"]).optional(),
  // Optional for replay compatibility. New declared collectors evaluate their
  // source-defined predicate independently of the model.
  semanticStatus: z.enum(["passed", "failed"]).optional(),
  observedAt: z.iso.datetime({ offset: true }),
  status: ReportEvidenceStatusSchema,
  command: z.string().min(1).optional(),
  url: HttpUrlSchema.optional(),
  exitCode: z.number().int().optional(),
  excerpt: z.string().min(1).max(2000).optional(),
  contentSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

export const ReportCheckV1Schema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean(),
  status: ReportCheckStatusSchema,
  summary: z.string().min(1),
  evidenceReceiptIds: z.array(z.string().min(1)),
});

export const ReportFindingV1Schema = z.object({
  section: z.string().min(1).optional(),
  severity: z.enum(["info", "warning", "critical"]),
  summary: z.string().min(1),
  detail: z.string().min(1).optional(),
  evidenceReceiptIds: z.array(z.string().min(1)).min(1),
});

export const ReportProvenanceV1Schema = z.object({
  workflowId: z.string().min(1),
  runId: z.string().min(1),
  temporalUrl: HttpUrlSchema.optional(),
  repoSha: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  windowStart: z.iso.datetime({ offset: true }).optional(),
  windowEnd: z.iso.datetime({ offset: true }).optional(),
  query: z.string().min(1).optional(),
});

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function validateUniqueIds(
  values: readonly string[],
  path: string,
  label: string,
  ctx: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({
      code: "custom",
      path: [path],
      message: `${label} ids must be unique`,
    });
  }
}

export const ReportEnvelopeV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    reportRunId: z.string().min(1),
    reportType: z.string().min(1),
    title: z.string().min(1),
    scheduleId: z.string().min(1).optional(),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
    execution: ReportExecutionSchema,
    verdict: ReportVerdictSchema,
    headline: z.string().min(1),
    checks: z.array(ReportCheckV1Schema).min(1),
    evidence: z.array(ReportEvidenceReceiptV1Schema),
    findings: z.array(ReportFindingV1Schema),
    limitations: z.array(z.string().min(1)),
    actions: z.array(z.string().min(1)),
    synthesis: z.string().min(1).optional(),
    retirementRecommendation: z.string().min(1).optional(),
    provenance: ReportProvenanceV1Schema,
  })
  .superRefine((report, ctx) => {
    if (Date.parse(report.completedAt) < Date.parse(report.startedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "completedAt must not be earlier than startedAt",
      });
    }

    if (report.synthesis !== undefined && wordCount(report.synthesis) > 80) {
      ctx.addIssue({
        code: "custom",
        path: ["synthesis"],
        message: "synthesis must contain at most 80 words",
      });
    }

    const evidenceById = new Map(
      report.evidence.map((receipt) => [receipt.id, receipt]),
    );
    validateUniqueIds(
      report.evidence.map((receipt) => receipt.id),
      "evidence",
      "evidence receipt",
      ctx,
    );
    validateUniqueIds(
      report.checks.map((check) => check.id),
      "checks",
      "check",
      ctx,
    );

    for (const [checkIndex, check] of report.checks.entries()) {
      for (const [
        referenceIndex,
        receiptId,
      ] of check.evidenceReceiptIds.entries()) {
        if (!evidenceById.has(receiptId)) {
          ctx.addIssue({
            code: "custom",
            path: ["checks", checkIndex, "evidenceReceiptIds", referenceIndex],
            message: `unknown evidence receipt: ${receiptId}`,
          });
        }
      }
      if (check.status === "passed") {
        const receipts = check.evidenceReceiptIds.flatMap((id) => {
          const receipt = evidenceById.get(id);
          return receipt === undefined ? [] : [receipt];
        });
        if (
          receipts.length === 0 ||
          receipts.some((receipt) => receipt.status !== "success")
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["checks", checkIndex, "evidenceReceiptIds"],
            message: "a passed check needs successful evidence",
          });
        }
      }
    }

    for (const [findingIndex, finding] of report.findings.entries()) {
      for (const [
        referenceIndex,
        receiptId,
      ] of finding.evidenceReceiptIds.entries()) {
        if (!evidenceById.has(receiptId)) {
          ctx.addIssue({
            code: "custom",
            path: [
              "findings",
              findingIndex,
              "evidenceReceiptIds",
              referenceIndex,
            ],
            message: `unknown evidence receipt: ${receiptId}`,
          });
        }
      }
    }

    const requiredChecks = report.checks.filter((check) => check.required);
    const requiredCoverageComplete = requiredChecks.every((check) => {
      const receipts = check.evidenceReceiptIds.flatMap((id) => {
        const receipt = evidenceById.get(id);
        return receipt === undefined ? [] : [receipt];
      });
      return (
        check.status !== "skipped" &&
        receipts.length > 0 &&
        receipts.length === check.evidenceReceiptIds.length &&
        receipts.every((receipt) => receipt.status === "success")
      );
    });
    if (!requiredCoverageComplete && report.execution === "complete") {
      ctx.addIssue({
        code: "custom",
        path: ["execution"],
        message:
          "complete execution requires successful evidence coverage for every required check",
      });
    }
    const allRequiredPassed = requiredChecks.every(
      (check) => check.status === "passed",
    );
    const invalidClearVerdict =
      report.verdict === "clear" &&
      (report.execution !== "complete" || !allRequiredPassed);
    if (invalidClearVerdict) {
      ctx.addIssue({
        code: "custom",
        path: ["verdict"],
        message: "clear verdict requires complete required-check coverage",
      });
    }
  });

export type ReportEnvelopeV1 = z.infer<typeof ReportEnvelopeV1Schema>;
export type ReportCheckV1 = z.infer<typeof ReportCheckV1Schema>;
export type ReportEvidenceReceiptV1 = z.infer<
  typeof ReportEvidenceReceiptV1Schema
>;
