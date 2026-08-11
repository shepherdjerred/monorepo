import { z } from "zod/v4";
import sanitizeHtml from "sanitize-html";

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

    const allRequiredPassed = report.checks
      .filter((check) => check.required)
      .every((check) => check.status === "passed");
    if (!allRequiredPassed && report.execution === "complete") {
      ctx.addIssue({
        code: "custom",
        path: ["execution"],
        message: "complete execution requires every required check to pass",
      });
    }
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

const SUBJECT_PREFIX: Record<ReportEnvelopeV1["verdict"], string> = {
  clear: "OK",
  changed: "CHANGED",
  attention: "ATTENTION",
  pending: "PENDING",
  inconclusive: "INCONCLUSIVE",
};

export function reportSubject(report: ReportEnvelopeV1): string {
  const prefix =
    report.execution === "failed"
      ? "FAILED"
      : report.execution === "partial"
        ? "PARTIAL"
        : SUBJECT_PREFIX[report.verdict];
  return `[${prefix}] ${report.title}`;
}

const ESCAPE_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: "escape",
};
const REPORT_LINK_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["a"],
  allowedAttributes: { a: ["href"] },
  allowedSchemes: ["http", "https"],
};

function escapeHtml(value: string): string {
  return sanitizeHtml(value, ESCAPE_TEXT_OPTIONS);
}

function reportLink(url: string, label: string): string {
  const normalizedUrl = new URL(url).href;
  return sanitizeHtml(
    `<a href="${normalizedUrl}">${escapeHtml(label)}</a>`,
    REPORT_LINK_OPTIONS,
  );
}

function htmlList(title: string, values: readonly string[]): string {
  if (values.length === 0) return "";
  return `<h2>${title}</h2><ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function evidenceHtml(
  report: ReportEnvelopeV1,
  receiptIds: readonly string[],
): string {
  const evidence = new Map(
    report.evidence.map((receipt) => [receipt.id, receipt]),
  );
  return receiptIds
    .map((id) => {
      const receipt = evidence.get(id);
      if (receipt?.url !== undefined) {
        return reportLink(receipt.url, id);
      }
      return `<code>${escapeHtml(id)}</code>`;
    })
    .join(", ");
}

function findingGroups(
  report: ReportEnvelopeV1,
): { section: string; items: ReportEnvelopeV1["findings"] }[] {
  const groups = new Map<string, ReportEnvelopeV1["findings"]>();
  for (const finding of report.findings) {
    const section = finding.section ?? "Findings";
    groups.set(section, [...(groups.get(section) ?? []), finding]);
  }
  return [...groups].map(([section, items]) => ({ section, items }));
}

export function renderReportHtml(report: ReportEnvelopeV1): string {
  const parsed = ReportEnvelopeV1Schema.parse(report);
  const rows = parsed.checks
    .map(
      (check) =>
        `<tr><td>${escapeHtml(check.required ? "required" : "optional")}</td><td>${escapeHtml(check.label)}</td><td>${escapeHtml(check.status)}</td><td>${escapeHtml(check.summary)}</td><td>${evidenceHtml(parsed, check.evidenceReceiptIds)}</td></tr>`,
    )
    .join("");
  const findings = findingGroups(parsed)
    .map(
      (group) =>
        `<h2>${escapeHtml(group.section)}</h2><ul>${group.items
          .map((finding) => {
            const detail =
              finding.detail === undefined
                ? ""
                : ` — ${escapeHtml(finding.detail)}`;
            const evidence = evidenceHtml(parsed, finding.evidenceReceiptIds);
            return `<li><strong>${escapeHtml(finding.severity)}</strong>: ${escapeHtml(finding.summary)}${detail}${evidence === "" ? "" : ` <small>Evidence: ${evidence}</small>`}</li>`;
          })
          .join("")}</ul>`,
    )
    .join("");
  const provenance = [
    `Report run: ${parsed.reportRunId}`,
    `Workflow: ${parsed.provenance.workflowId}`,
    `Run: ${parsed.provenance.runId}`,
    parsed.provenance.temporalUrl === undefined
      ? undefined
      : `Temporal: ${parsed.provenance.temporalUrl}`,
    parsed.provenance.repoSha === undefined
      ? undefined
      : `Repository SHA: ${parsed.provenance.repoSha}`,
    parsed.provenance.windowStart === undefined
      ? undefined
      : `Window start: ${parsed.provenance.windowStart}`,
    parsed.provenance.windowEnd === undefined
      ? undefined
      : `Window end: ${parsed.provenance.windowEnd}`,
    parsed.provenance.source === undefined
      ? undefined
      : `Source: ${parsed.provenance.source}`,
    parsed.provenance.query === undefined
      ? undefined
      : `Query: ${parsed.provenance.query}`,
  ].filter((value) => value !== undefined);

  return [
    "<!doctype html><html><body>",
    `<h1>${escapeHtml(reportSubject(parsed))}</h1>`,
    `<p><strong>${escapeHtml(parsed.headline)}</strong></p>`,
    parsed.synthesis === undefined
      ? ""
      : `<p>${escapeHtml(parsed.synthesis)}</p>`,
    "<h2>Checks</h2>",
    `<table><thead><tr><th>Coverage</th><th>Check</th><th>Status</th><th>Result</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>`,
    findings,
    htmlList("Limitations", parsed.limitations),
    htmlList("Actions", parsed.actions),
    parsed.retirementRecommendation === undefined
      ? ""
      : `<h2>Retirement recommendation</h2><p>${escapeHtml(parsed.retirementRecommendation)}</p>`,
    htmlList("Provenance", provenance),
    "</body></html>",
  ].join("");
}

function textSection(title: string, values: readonly string[]): string[] {
  return values.length === 0
    ? []
    : ["", title, ...values.map((value) => `- ${value}`)];
}

function evidenceText(
  report: ReportEnvelopeV1,
  receiptIds: readonly string[],
): string {
  const evidence = new Map(
    report.evidence.map((receipt) => [receipt.id, receipt]),
  );
  return receiptIds
    .map((id) => {
      const receipt = evidence.get(id);
      return `${id}${receipt?.url === undefined ? "" : ` (${receipt.url})`}`;
    })
    .join(", ");
}

export function renderReportText(report: ReportEnvelopeV1): string {
  const parsed = ReportEnvelopeV1Schema.parse(report);
  const lines = [reportSubject(parsed), parsed.headline];
  if (parsed.synthesis !== undefined) lines.push("", parsed.synthesis);
  lines.push(
    "",
    "Checks",
    ...parsed.checks.map((check) => {
      const evidence = evidenceText(parsed, check.evidenceReceiptIds);
      return `- [${check.status}] ${check.label} (${check.required ? "required" : "optional"}): ${check.summary}${evidence === "" ? "" : ` [evidence: ${evidence}]`}`;
    }),
  );
  for (const group of findingGroups(parsed)) {
    lines.push(
      "",
      group.section,
      ...group.items.map((finding) => {
        const evidence = evidenceText(parsed, finding.evidenceReceiptIds);
        return `- [${finding.severity}] ${finding.summary}${finding.detail === undefined ? "" : ` — ${finding.detail}`}${evidence === "" ? "" : ` [evidence: ${evidence}]`}`;
      }),
    );
  }
  lines.push(...textSection("Limitations", parsed.limitations));
  lines.push(...textSection("Actions", parsed.actions));
  if (parsed.retirementRecommendation !== undefined) {
    lines.push(
      "",
      "Retirement recommendation",
      parsed.retirementRecommendation,
    );
  }
  lines.push(
    "",
    "Provenance",
    `- Report run: ${parsed.reportRunId}`,
    `- Workflow: ${parsed.provenance.workflowId}`,
    `- Run: ${parsed.provenance.runId}`,
  );
  if (parsed.provenance.temporalUrl !== undefined) {
    lines.push(`- Temporal: ${parsed.provenance.temporalUrl}`);
  }
  if (parsed.provenance.repoSha !== undefined) {
    lines.push(`- Repository SHA: ${parsed.provenance.repoSha}`);
  }
  if (parsed.provenance.windowStart !== undefined) {
    lines.push(`- Window start: ${parsed.provenance.windowStart}`);
  }
  if (parsed.provenance.windowEnd !== undefined) {
    lines.push(`- Window end: ${parsed.provenance.windowEnd}`);
  }
  if (parsed.provenance.source !== undefined) {
    lines.push(`- Source: ${parsed.provenance.source}`);
  }
  if (parsed.provenance.query !== undefined) {
    lines.push(`- Query: ${parsed.provenance.query}`);
  }
  return `${lines.join("\n")}\n`;
}
