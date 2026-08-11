import { z } from "zod/v4";
import {
  agentTaskChecksV2,
  AgentTaskResultPayloadV2Schema,
  type AgentTaskEvidenceCriterionV2,
  type AgentTaskInput,
  type AgentTaskProvider,
  type AgentTaskResultPayloadV2,
} from "./agent-task.ts";
import type {
  ReportCheckV1,
  ReportEnvelopeV1,
  ReportEvidenceReceiptV1,
} from "./report.ts";

const ClaudeContentSchema = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
  tool_use_id: z.string().optional(),
  content: z.unknown().optional(),
  is_error: z.boolean().optional(),
});

const ClaudeEventSchema = z.looseObject({
  type: z.string(),
  message: z
    .looseObject({ content: z.array(ClaudeContentSchema).optional() })
    .optional(),
});

const CodexCommandEventSchema = z.object({
  type: z.literal("item.completed"),
  item: z.looseObject({
    id: z.string(),
    type: z.literal("command_execution"),
    command: z.string(),
    aggregated_output: z.string().optional(),
    exit_code: z.number().int().optional(),
    status: z.string().optional(),
  }),
});

type ToolUse = {
  name: string;
  input: unknown;
};

export type NormalizedAgentTaskV2Result = {
  execution: ReportEnvelopeV1["execution"];
  verdict: ReportEnvelopeV1["verdict"];
  headline: string;
  checks: ReportCheckV1[];
  findings: ReportEnvelopeV1["findings"];
  limitations: string[];
  actions: string[];
  synthesis: string | undefined;
  retirementRecommendation: string | undefined;
  followUp: AgentTaskResultPayloadV2["followUp"];
};

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function stringifyEvidence(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function bounded(value: string, maximum = 2000): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= maximum ? trimmed : `${trimmed.slice(0, maximum)}…`;
}

function sha256(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}

function toolUseSource(tool: ToolUse): {
  source: string;
  command?: string;
  url?: string;
} {
  const input = z.record(z.string(), z.unknown()).safeParse(tool.input);
  const command = input.success ? input.data["command"] : undefined;
  const url = input.success ? input.data["url"] : undefined;
  return {
    source: tool.name,
    ...(typeof command === "string" && command.length > 0 ? { command } : {}),
    ...(typeof url === "string" && z.url().safeParse(url).success
      ? { url }
      : {}),
  };
}

function extractClaudeReceipts(
  stdout: string,
  observedAt: string,
  redact: (value: string) => string,
): ReportEvidenceReceiptV1[] {
  const uses = new Map<string, ToolUse>();
  const receipts: ReportEvidenceReceiptV1[] = [];
  for (const line of stdout.split("\n")) {
    const event = ClaudeEventSchema.safeParse(parseLine(line));
    if (!event.success) continue;
    for (const content of event.data.message?.content ?? []) {
      if (
        content.type === "tool_use" &&
        content.id !== undefined &&
        content.name !== undefined
      ) {
        uses.set(content.id, { name: content.name, input: content.input });
        continue;
      }
      if (content.type !== "tool_result" || content.tool_use_id === undefined) {
        continue;
      }
      const use = uses.get(content.tool_use_id);
      if (use === undefined) continue;
      const output = redact(stringifyEvidence(content.content));
      const excerpt = bounded(output);
      const source = toolUseSource(use);
      const redactedUrl =
        source.url === undefined ? undefined : redact(source.url);
      receipts.push({
        id: content.tool_use_id,
        source: source.source,
        observedAt,
        status: content.is_error === true ? "failure" : "success",
        ...(source.command === undefined
          ? {}
          : { command: redact(source.command) }),
        ...(redactedUrl === undefined || !z.url().safeParse(redactedUrl).success
          ? {}
          : { url: redactedUrl }),
        ...(excerpt === undefined ? {} : { excerpt }),
        contentSha256: sha256(output),
      });
    }
  }
  return receipts;
}

function extractCodexReceipts(
  stdout: string,
  observedAt: string,
  redact: (value: string) => string,
): ReportEvidenceReceiptV1[] {
  const receipts: ReportEvidenceReceiptV1[] = [];
  for (const line of stdout.split("\n")) {
    const event = CodexCommandEventSchema.safeParse(parseLine(line));
    if (!event.success) continue;
    const output = redact(event.data.item.aggregated_output ?? "");
    const excerpt = bounded(output);
    const exitCode = event.data.item.exit_code;
    receipts.push({
      id: event.data.item.id,
      source: "command_execution",
      observedAt,
      status:
        exitCode === 0 && event.data.item.status !== "failed"
          ? "success"
          : "failure",
      command: redact(event.data.item.command),
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(excerpt === undefined ? {} : { excerpt }),
      contentSha256: sha256(output),
    });
  }
  return receipts;
}

export function extractAgentTaskEvidenceReceipts(
  stdout: string,
  provider: AgentTaskProvider,
  observedAt: string,
  redact: (value: string) => string,
): ReportEvidenceReceiptV1[] {
  return provider === "claude"
    ? extractClaudeReceipts(stdout, observedAt, redact)
    : extractCodexReceipts(stdout, observedAt, redact);
}

function deriveAgentTaskVerdict(
  execution: ReportEnvelopeV1["execution"],
  checks: readonly ReportCheckV1[],
  findings: ReportEnvelopeV1["findings"],
): ReportEnvelopeV1["verdict"] {
  if (execution === "partial" || execution === "failed") {
    return "inconclusive";
  }
  if (
    checks.some((check) => check.status === "failed") ||
    findings.some(
      (finding) =>
        finding.severity === "warning" || finding.severity === "critical",
    )
  ) {
    return "attention";
  }
  if (findings.length > 0) return "changed";
  if (checks.some((check) => check.status === "skipped")) return "pending";
  return "clear";
}

function evidenceField(
  receipt: ReportEvidenceReceiptV1,
  field: AgentTaskEvidenceCriterionV2["field"],
): string | undefined {
  if (field === "source") return receipt.source;
  if (field === "command") return receipt.command;
  if (field === "url") return receipt.url;
  return receipt.excerpt;
}

function unmatchedEvidenceCriteria(
  criteria: readonly AgentTaskEvidenceCriterionV2[],
  receipts: readonly ReportEvidenceReceiptV1[],
): AgentTaskEvidenceCriterionV2[] {
  return criteria.filter((criterion) =>
    receipts.every((receipt) => {
      const value = evidenceField(receipt, criterion.field);
      return (
        value?.toLowerCase().includes(criterion.includes.toLowerCase()) !== true
      );
    }),
  );
}

function describeEvidenceCriterion(
  criterion: AgentTaskEvidenceCriterionV2,
): string {
  return `${criterion.field} includes ${JSON.stringify(criterion.includes)}`;
}

export function normalizeAgentTaskV2Result(
  input: AgentTaskInput,
  rawPayload: AgentTaskResultPayloadV2,
  evidence: readonly ReportEvidenceReceiptV1[],
): NormalizedAgentTaskV2Result {
  const payload = AgentTaskResultPayloadV2Schema.parse(rawPayload);
  const declaredChecks = agentTaskChecksV2(input);
  const evidenceById = new Map(
    evidence.map((receipt) => [receipt.id, receipt]),
  );
  const payloadChecks = new Map(
    payload.checks.map((check) => [check.id, check]),
  );
  const limitations = [...payload.limitations];
  let evidenceIntegrityComplete = true;
  if (payloadChecks.size !== payload.checks.length) {
    limitations.push("The agent returned duplicate check ids.");
    evidenceIntegrityComplete = false;
  }

  const declaredIds = new Set(declaredChecks.map((check) => check.id));
  const unknownCheckIds = payload.checks
    .map((check) => check.id)
    .filter((id) => !declaredIds.has(id));
  if (unknownCheckIds.length > 0) {
    limitations.push(
      `The agent returned undeclared checks: ${unknownCheckIds.join(", ")}.`,
    );
    evidenceIntegrityComplete = false;
  }

  const checks = declaredChecks.map((declared) => {
    const result = payloadChecks.get(declared.id);
    if (result === undefined) {
      return {
        id: declared.id,
        label: declared.label,
        required: declared.required,
        status: "skipped" as const,
        summary: "The agent did not return this declared check.",
        evidenceReceiptIds: [],
      };
    }
    const knownReceipts = result.evidenceReceiptIds.filter((id) =>
      evidenceById.has(id),
    );
    const capturedReceipts = knownReceipts.flatMap((id) => {
      const receipt = evidenceById.get(id);
      return receipt === undefined ? [] : [receipt];
    });
    const captureCompleteAndSuccessful =
      result.evidenceReceiptIds.length > 0 &&
      knownReceipts.length === result.evidenceReceiptIds.length &&
      capturedReceipts.every((receipt) => receipt.status === "success");
    if (knownReceipts.length !== result.evidenceReceiptIds.length) {
      limitations.push(
        `Check ${declared.id} referenced evidence that was not captured by the provider transcript.`,
      );
      evidenceIntegrityComplete = false;
    }
    const criteria = declared.evidenceCriteria;
    const unmatchedCriteria =
      criteria === undefined
        ? []
        : unmatchedEvidenceCriteria(criteria, capturedReceipts);
    if (criteria === undefined) {
      limitations.push(
        `Check ${declared.id} lacks machine-verifiable evidence criteria; legacy v2 coverage cannot be complete.`,
      );
      evidenceIntegrityComplete = false;
    } else if (unmatchedCriteria.length > 0) {
      limitations.push(
        `Check ${declared.id} evidence did not satisfy criteria: ${unmatchedCriteria.map((criterion) => describeEvidenceCriterion(criterion)).join(", ")}.`,
      );
      evidenceIntegrityComplete = false;
    }
    const successfulEvidence =
      captureCompleteAndSuccessful &&
      criteria !== undefined &&
      unmatchedCriteria.length === 0;
    if (!successfulEvidence && result.status === "passed") {
      limitations.push(
        `Check ${declared.id} does not have complete successful evidence satisfying its declared criteria.`,
      );
      evidenceIntegrityComplete = false;
    }
    const status =
      !successfulEvidence && result.status === "passed"
        ? "failed"
        : result.status;
    const summary =
      !successfulEvidence && result.status === "passed"
        ? `${result.summary} Evidence validation failed.`
        : result.summary;
    return {
      id: declared.id,
      label: declared.label,
      required: declared.required,
      status,
      summary,
      evidenceReceiptIds: knownReceipts,
    };
  });
  const allRequiredPassed = checks
    .filter((check) => check.required)
    .every((check) => check.status === "passed");
  const findings = payload.findings.flatMap((finding) => {
    const knownReceiptIds = finding.evidenceReceiptIds.filter((id) =>
      evidenceById.has(id),
    );
    const evidenceComplete =
      finding.evidenceReceiptIds.length > 0 &&
      knownReceiptIds.length === finding.evidenceReceiptIds.length &&
      knownReceiptIds.every((id) => evidenceById.get(id)?.status === "success");
    if (!evidenceComplete) {
      limitations.push(
        `Finding "${finding.summary}" lacks complete successful captured evidence.`,
      );
      evidenceIntegrityComplete = false;
      return [];
    }
    return [{ ...finding, evidenceReceiptIds: knownReceiptIds }];
  });
  const execution =
    allRequiredPassed && evidenceIntegrityComplete ? "complete" : "partial";
  const verdict = deriveAgentTaskVerdict(execution, checks, findings);
  return {
    execution,
    verdict,
    headline: payload.headline,
    checks,
    findings,
    limitations: [...new Set(limitations)],
    actions: payload.actions,
    synthesis: payload.synthesis,
    retirementRecommendation: payload.retirementRecommendation,
    followUp: payload.followUp,
  };
}
