import { z } from "zod/v4";
import {
  agentTaskChecksV2,
  AgentTaskResultPayloadV2Schema,
  type AgentTaskInput,
  type AgentTaskProvider,
  type AgentTaskResultPayloadV2,
} from "./agent-task.ts";
import { agentTaskCollectorReceiptId } from "./agent-task-evidence-contract.ts";
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
  events: readonly unknown[],
  observedAt: string,
  redact: (value: string) => string,
): ReportEvidenceReceiptV1[] {
  const uses = new Map<string, ToolUse>();
  const receipts: ReportEvidenceReceiptV1[] = [];
  for (const rawEvent of events) {
    const event = ClaudeEventSchema.safeParse(rawEvent);
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
        origin: "provider",
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
  events: readonly unknown[],
  observedAt: string,
  redact: (value: string) => string,
): ReportEvidenceReceiptV1[] {
  const receipts: ReportEvidenceReceiptV1[] = [];
  for (const rawEvent of events) {
    const event = CodexCommandEventSchema.safeParse(rawEvent);
    if (!event.success) continue;
    const output = redact(event.data.item.aggregated_output ?? "");
    const excerpt = bounded(output);
    const exitCode = event.data.item.exit_code;
    receipts.push({
      id: event.data.item.id,
      source: "command_execution",
      origin: "provider",
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

// Receipts are derived from the native SDK's already-redacted event stream, so
// a provider tool call that never produced an event cannot be cited later.
export function extractAgentTaskEvidenceReceipts(
  events: readonly unknown[],
  provider: AgentTaskProvider,
  observedAt: string,
  redact: (value: string) => string,
): ReportEvidenceReceiptV1[] {
  return provider === "claude"
    ? extractClaudeReceipts(events, observedAt, redact)
    : extractCodexReceipts(events, observedAt, redact);
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

type DeclaredCheckV2 = ReturnType<typeof agentTaskChecksV2>[number];
type PayloadCheckV2 = AgentTaskResultPayloadV2["checks"][number];

type NormalizedCheck = {
  check: ReportCheckV1;
  evidenceIntegrityComplete: boolean;
  limitations: string[];
};

function expectedCollectorReceiptIds(declared: DeclaredCheckV2): string[] {
  return (declared.evidenceCollectors ?? []).map((collector) =>
    agentTaskCollectorReceiptId(declared.id, collector.id),
  );
}

function normalizeDeclaredCheck(
  declared: DeclaredCheckV2,
  result: PayloadCheckV2 | undefined,
  evidenceById: ReadonlyMap<string, ReportEvidenceReceiptV1>,
): NormalizedCheck {
  const limitations: string[] = [];
  let evidenceIntegrityComplete = true;
  const expectedCollectorIds = expectedCollectorReceiptIds(declared);
  const normalizedResult: PayloadCheckV2 = result ?? {
    id: declared.id,
    status: "skipped",
    summary: "The agent did not return this declared check.",
    evidenceReceiptIds: expectedCollectorIds,
  };
  const knownReceipts = normalizedResult.evidenceReceiptIds.filter((id) =>
    evidenceById.has(id),
  );
  const capturedReceipts = knownReceipts.flatMap((id) => {
    const receipt = evidenceById.get(id);
    return receipt === undefined ? [] : [receipt];
  });
  if (knownReceipts.length !== normalizedResult.evidenceReceiptIds.length) {
    limitations.push(
      `Check ${declared.id} referenced evidence that was not captured by the provider transcript.`,
    );
    evidenceIntegrityComplete = false;
  }
  if (
    normalizedResult.evidenceReceiptIds.length === 0 ||
    capturedReceipts.some((receipt) => receipt.status !== "success")
  ) {
    limitations.push(
      `Check ${declared.id} does not have complete successful independently collected evidence.`,
    );
    evidenceIntegrityComplete = false;
  }

  const collectors = declared.evidenceCollectors;
  const missingCollectorIds = expectedCollectorIds.filter((id) => {
    const receipt = evidenceById.get(id);
    return receipt?.origin !== "declared-collector";
  });
  const failedCollectorIds = expectedCollectorIds.filter((id) => {
    const receipt = evidenceById.get(id);
    return (
      receipt?.origin === "declared-collector" && receipt.status !== "success"
    );
  });
  const missingSemanticStatusIds = expectedCollectorIds.filter((id) => {
    const receipt = evidenceById.get(id);
    return (
      receipt?.origin === "declared-collector" &&
      receipt.status === "success" &&
      receipt.semanticStatus === undefined
    );
  });
  const adverseSemanticStatusIds = expectedCollectorIds.filter((id) => {
    const receipt = evidenceById.get(id);
    return (
      receipt?.origin === "declared-collector" &&
      receipt.status === "success" &&
      receipt.semanticStatus === "failed"
    );
  });
  const uncitedCollectorIds = expectedCollectorIds.filter(
    (id) => !normalizedResult.evidenceReceiptIds.includes(id),
  );

  if (collectors === undefined) {
    limitations.push(
      `Check ${declared.id} lacks independently declared evidence collectors; legacy v2 coverage cannot be complete.`,
    );
    evidenceIntegrityComplete = false;
  }
  if (missingCollectorIds.length > 0) {
    limitations.push(
      `Check ${declared.id} is missing independently collected receipts: ${missingCollectorIds.join(", ")}.`,
    );
    evidenceIntegrityComplete = false;
  }
  if (failedCollectorIds.length > 0) {
    limitations.push(
      `Check ${declared.id} has failed independently collected receipts: ${failedCollectorIds.join(", ")}.`,
    );
    evidenceIntegrityComplete = false;
  }
  if (missingSemanticStatusIds.length > 0) {
    limitations.push(
      `Check ${declared.id} has receipts without a source-defined semantic result: ${missingSemanticStatusIds.join(", ")}.`,
    );
    evidenceIntegrityComplete = false;
  }
  if (uncitedCollectorIds.length > 0) {
    limitations.push(
      `Check ${declared.id} did not cite its independently collected receipts: ${uncitedCollectorIds.join(", ")}.`,
    );
    evidenceIntegrityComplete = false;
  }

  const semanticPredicatesPassed = adverseSemanticStatusIds.length === 0;
  const status =
    !semanticPredicatesPassed ||
    (!evidenceIntegrityComplete && normalizedResult.status === "passed")
      ? "failed"
      : normalizedResult.status;
  const summary =
    !evidenceIntegrityComplete && normalizedResult.status === "passed"
      ? `${normalizedResult.summary} Evidence validation failed.`
      : !semanticPredicatesPassed && normalizedResult.status !== "failed"
        ? `${normalizedResult.summary} Source-defined collector predicates failed: ${adverseSemanticStatusIds.join(", ")}.`
        : normalizedResult.summary;
  return {
    check: {
      id: declared.id,
      label: declared.label,
      required: declared.required,
      status,
      summary,
      evidenceReceiptIds: knownReceipts,
    },
    evidenceIntegrityComplete,
    limitations,
  };
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

  const normalizedChecks = declaredChecks.map((declared) =>
    normalizeDeclaredCheck(
      declared,
      payloadChecks.get(declared.id),
      evidenceById,
    ),
  );
  const checks = normalizedChecks.map((normalized) => normalized.check);
  limitations.push(
    ...normalizedChecks.flatMap((normalized) => normalized.limitations),
  );
  if (
    normalizedChecks.some((normalized) => !normalized.evidenceIntegrityComplete)
  ) {
    evidenceIntegrityComplete = false;
  }
  const requiredCoverageComplete = checks
    .filter((check) => check.required)
    .every((check) => check.status !== "skipped");
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
    requiredCoverageComplete && evidenceIntegrityComplete
      ? "complete"
      : "partial";
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
