import { z } from "zod";
import {
  safeHttpUrl,
  type EmailActionLink,
  type EmailItemCard,
  type EmailTone,
} from "@shepherdjerred/ops-model/email/primitives.ts";

const HttpUrlSchema = z.url({ protocol: /^https?$/u });

export const ReportExecutionSchema = z.enum(["complete", "partial", "failed"]);
export type ReportExecution = z.infer<typeof ReportExecutionSchema>;

export const ReportVerdictSchema = z.enum([
  "clear",
  "changed",
  "attention",
  "pending",
  "inconclusive",
]);
export type ReportVerdict = z.infer<typeof ReportVerdictSchema>;

export const ReportCheckStatusSchema = z.enum(["passed", "failed", "skipped"]);
export type ReportCheckStatus = z.infer<typeof ReportCheckStatusSchema>;

export const ReportEvidenceStatusSchema = z.enum(["success", "failure"]);
export type ReportEvidenceStatus = z.infer<typeof ReportEvidenceStatusSchema>;

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
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
});
export type ReportEvidenceReceiptV1 = z.infer<
  typeof ReportEvidenceReceiptV1Schema
>;

export const ReportCheckV1Schema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean(),
  status: ReportCheckStatusSchema,
  summary: z.string().min(1),
  evidenceReceiptIds: z.array(z.string().min(1)),
});
export type ReportCheckV1 = z.infer<typeof ReportCheckV1Schema>;

export const ReportFindingV1Schema = z.object({
  // Optional so retained report and Activity payloads remain readable.
  id: z.string().min(1).optional(),
  state: z.enum(["active", "recovered", "suppressed", "observing"]).optional(),
  section: z.string().min(1).optional(),
  // Stable classification of the current condition, excluding volatile detail.
  condition: z.string().min(1).optional(),
  severity: z.enum(["info", "warning", "critical"]),
  summary: z.string().min(1),
  detail: z.string().min(1).optional(),
  evidenceReceiptIds: z.array(z.string().min(1)).min(1),
});
export type ReportFindingV1 = z.infer<typeof ReportFindingV1Schema>;

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
export type ReportProvenanceV1 = z.infer<typeof ReportProvenanceV1Schema>;

export const ReportRemediationOutcomeSchema = z.enum([
  "pr-created",
  "pr-reused",
  "no-changes",
  "partial",
  "skipped",
]);
export type ReportRemediationOutcome = z.infer<
  typeof ReportRemediationOutcomeSchema
>;

export const ReportRemediationV1Schema = z.object({
  outcome: ReportRemediationOutcomeSchema,
  prUrl: HttpUrlSchema.optional(),
  branchName: z.string().min(1).optional(),
  commitSha: z.string().min(1).optional(),
  autoMergeEnabled: z.boolean().optional(),
  changedFiles: z.array(z.string().min(1)).default([]),
  resolvedCount: z.number().int().nonnegative().optional(),
  unresolvedCount: z.number().int().nonnegative().optional(),
  summary: z.string().min(1).optional(),
});
export type ReportRemediationV1 = z.infer<typeof ReportRemediationV1Schema>;
export type ReportRemediationInputV1 = z.input<
  typeof ReportRemediationV1Schema
>;

const ReportEnvelopeBaseSchema = z.object({
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
  remediation: ReportRemediationV1Schema.optional(),
  provenance: ReportProvenanceV1Schema,
});

type ReportEnvelopeBase = z.infer<typeof ReportEnvelopeBaseSchema>;

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function validateUniqueIds(
  values: readonly string[],
  path: string,
  label: string,
  ctx: z.core.$RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({
      code: "custom",
      path: [path],
      message: `${label} ids must be unique`,
    });
  }
}

function validateEnvelopeMetadata(
  report: ReportEnvelopeBase,
  ctx: z.core.$RefinementCtx,
): void {
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
}

function resolveReceipts(
  receiptIds: readonly string[],
  evidenceById: ReadonlyMap<string, ReportEvidenceReceiptV1>,
): ReportEvidenceReceiptV1[] {
  return receiptIds.flatMap((id) => {
    const receipt = evidenceById.get(id);
    return receipt === undefined ? [] : [receipt];
  });
}

function validateReceiptReferences(
  receiptIds: readonly string[],
  basePath: readonly (string | number)[],
  evidenceById: ReadonlyMap<string, ReportEvidenceReceiptV1>,
  ctx: z.core.$RefinementCtx,
): void {
  for (const [referenceIndex, receiptId] of receiptIds.entries()) {
    if (!evidenceById.has(receiptId)) {
      ctx.addIssue({
        code: "custom",
        path: [...basePath, referenceIndex],
        message: `unknown evidence receipt: ${receiptId}`,
      });
    }
  }
}

function validateCheckEvidence(
  checks: readonly ReportCheckV1[],
  evidenceById: ReadonlyMap<string, ReportEvidenceReceiptV1>,
  ctx: z.core.$RefinementCtx,
): void {
  for (const [checkIndex, check] of checks.entries()) {
    validateReceiptReferences(
      check.evidenceReceiptIds,
      ["checks", checkIndex, "evidenceReceiptIds"],
      evidenceById,
      ctx,
    );
    if (check.status !== "passed") continue;

    const receipts = resolveReceipts(check.evidenceReceiptIds, evidenceById);
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

function validateFindingEvidence(
  findings: readonly ReportFindingV1[],
  evidenceById: ReadonlyMap<string, ReportEvidenceReceiptV1>,
  ctx: z.core.$RefinementCtx,
): void {
  for (const [findingIndex, finding] of findings.entries()) {
    validateReceiptReferences(
      finding.evidenceReceiptIds,
      ["findings", findingIndex, "evidenceReceiptIds"],
      evidenceById,
      ctx,
    );
  }
}

function validateRequiredCoverageAndVerdict(
  report: ReportEnvelopeBase,
  evidenceById: ReadonlyMap<string, ReportEvidenceReceiptV1>,
  ctx: z.core.$RefinementCtx,
): void {
  const requiredChecks = report.checks.filter((check) => check.required);
  const requiredCoverageComplete = requiredChecks.every((check) => {
    const receipts = resolveReceipts(check.evidenceReceiptIds, evidenceById);
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
  if (
    report.verdict === "clear" &&
    (!allRequiredPassed || report.execution !== "complete")
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["verdict"],
      message: "clear verdict requires complete required-check coverage",
    });
  }
}

export const ReportEnvelopeV1Schema = ReportEnvelopeBaseSchema.superRefine(
  (report, ctx) => {
    validateEnvelopeMetadata(report, ctx);
    const evidenceById = new Map(
      report.evidence.map((receipt) => [receipt.id, receipt]),
    );
    validateCheckEvidence(report.checks, evidenceById, ctx);
    validateFindingEvidence(report.findings, evidenceById, ctx);
    validateRequiredCoverageAndVerdict(report, evidenceById, ctx);
  },
);

export type ReportEnvelopeV1 = z.infer<typeof ReportEnvelopeV1Schema>;
export type ReportEnvelopeInputV1 = z.input<typeof ReportEnvelopeV1Schema>;

export function reportEvidenceSourceLinks(
  evidence: readonly Pick<ReportEvidenceReceiptV1, "id" | "url">[],
  receiptIds: readonly string[],
): EmailActionLink[] {
  const byId = new Map(evidence.map((receipt) => [receipt.id, receipt]));
  const urls = [
    ...new Set(
      receiptIds.flatMap((id) => {
        const href = safeHttpUrl(byId.get(id)?.url);
        return href === null ? [] : [href];
      }),
    ),
  ];
  return urls.map((url, index) => ({
    label:
      urls.length === 1 ? "View source" : `View source ${String(index + 1)}`,
    url,
  }));
}

export function reportFindingToEmailCard(
  evidence: readonly Pick<ReportEvidenceReceiptV1, "id" | "url">[],
  finding: Pick<
    ReportFindingV1,
    "severity" | "section" | "summary" | "detail" | "evidenceReceiptIds"
  >,
): EmailItemCard {
  const links = reportEvidenceSourceLinks(evidence, finding.evidenceReceiptIds);
  const { tone, badge }: { tone: EmailTone; badge: string } =
    finding.severity === "critical"
      ? { tone: "critical", badge: "Critical" }
      : finding.severity === "warning"
        ? { tone: "warning", badge: "Warning" }
        : { tone: "info", badge: "Note" };
  return {
    tone,
    badge,
    ...(finding.section === undefined ? {} : { kicker: finding.section }),
    title: finding.summary,
    ...(finding.detail === undefined ? {} : { body: finding.detail }),
    ...(links.length === 0 ? {} : { links }),
  };
}
