import {
  claudeDiagnostics,
  contractErrorMessage,
  malformedClaudeDiagnostics,
} from "./agent-task-claude-diagnostics.ts";
import {
  AGENT_TASK_CLAUDE_SCHEMA_FINGERPRINT,
  AGENT_TASK_CLAUDE_SCHEMA_V2_FINGERPRINT,
  AgentTaskFollowUpSchema,
  AgentTaskFollowUpV2Schema,
  AgentTaskOutputContractError,
  AgentTaskResultPayloadSchema,
  AgentTaskResultPayloadV2Schema,
  AgentTaskWireResultPayloadSchema,
  AgentTaskWireResultPayloadV2Schema,
  type AgentTaskFollowUp,
  type AgentTaskFollowUpV2,
  type AgentTaskProvider,
  type AgentTaskResultPayload,
  type AgentTaskResultPayloadV2,
  type AgentTaskWireResultPayload,
  type AgentTaskWireResultPayloadV2,
  type ClaudeOutputContractDiagnostics,
} from "./agent-task.ts";
import {
  parseClaudeResultMessage,
  type ClaudeResultMessage,
} from "./claude-result.ts";

function normalizeAgentTaskFollowUp(
  followUp: AgentTaskWireResultPayload["followUp"],
): AgentTaskFollowUp | undefined {
  if (followUp === null) return undefined;
  return AgentTaskFollowUpSchema.parse({
    title: followUp.title,
    prompt: followUp.prompt,
    ...(followUp.provider === null ? {} : { provider: followUp.provider }),
    ...(followUp.runAt === null ? {} : { runAt: followUp.runAt }),
    ...(followUp.cron === null ? {} : { cron: followUp.cron }),
    ...(followUp.model === null ? {} : { model: followUp.model }),
    ...(followUp.maxTurns === null ? {} : { maxTurns: followUp.maxTurns }),
    ...(followUp.agentTimeoutMinutes === null
      ? {}
      : { agentTimeoutMinutes: followUp.agentTimeoutMinutes }),
  });
}

function normalizeAgentTaskFollowUpV2(
  followUp: AgentTaskWireResultPayloadV2["followUp"],
): AgentTaskFollowUpV2 | undefined {
  if (followUp === null) return undefined;
  return AgentTaskFollowUpV2Schema.parse({
    title: followUp.title,
    prompt: followUp.prompt,
    ...(followUp.provider === null ? {} : { provider: followUp.provider }),
    ...(followUp.runAt === null ? {} : { runAt: followUp.runAt }),
    ...(followUp.cron === null ? {} : { cron: followUp.cron }),
    ...(followUp.model === null ? {} : { model: followUp.model }),
    ...(followUp.maxTurns === null ? {} : { maxTurns: followUp.maxTurns }),
    ...(followUp.agentTimeoutMinutes === null
      ? {}
      : { agentTimeoutMinutes: followUp.agentTimeoutMinutes }),
  });
}

function normalizeCodexV2(
  wire: AgentTaskWireResultPayloadV2,
): AgentTaskResultPayloadV2 {
  const followUp = normalizeAgentTaskFollowUpV2(wire.followUp);
  return AgentTaskResultPayloadV2Schema.parse({
    headline: wire.headline,
    checks: wire.checks,
    findings: wire.findings.map((finding) => ({
      severity: finding.severity,
      summary: finding.summary,
      ...(finding.detail === null ? {} : { detail: finding.detail }),
      evidenceReceiptIds: finding.evidenceReceiptIds,
    })),
    limitations: wire.limitations,
    actions: wire.actions,
    ...(wire.synthesis === null ? {} : { synthesis: wire.synthesis }),
    ...(followUp === undefined ? {} : { followUp }),
    ...(wire.retirementRecommendation === null
      ? {}
      : { retirementRecommendation: wire.retirementRecommendation }),
  });
}

function normalizeCodexV1(
  wire: AgentTaskWireResultPayload,
): AgentTaskResultPayload {
  const followUp = normalizeAgentTaskFollowUp(wire.followUp);
  return AgentTaskResultPayloadSchema.parse({
    markdown: wire.markdown,
    ...(followUp === undefined ? {} : { followUp }),
    ...(wire.cancelCron === null ? {} : { cancelCron: wire.cancelCron }),
    ...(wire.cancelReason === null ? {} : { cancelReason: wire.cancelReason }),
  });
}

export function parseAgentTaskResultPayload(
  raw: unknown,
  provider: AgentTaskProvider,
  contractVersion: 1 | 2 = 1,
): AgentTaskResultPayload | AgentTaskResultPayloadV2 {
  if (raw === undefined || raw === "") {
    throw new Error(
      "agent produced no structured output (expected --json-schema structured_output / --output-schema file)",
    );
  }
  try {
    const decoded: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (provider === "claude") {
      return contractVersion === 2
        ? AgentTaskResultPayloadV2Schema.parse(decoded)
        : AgentTaskResultPayloadSchema.parse(decoded);
    }
    return contractVersion === 2
      ? normalizeCodexV2(AgentTaskWireResultPayloadV2Schema.parse(decoded))
      : normalizeCodexV1(AgentTaskWireResultPayloadSchema.parse(decoded));
  } catch (error: unknown) {
    throw new Error(
      `Failed to parse agent task JSON payload: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function parseClaudeContractInput(
  stdout: string,
  redactExcerpt: (value: string) => string,
  schemaFingerprint: string,
): {
  resultMessage: ClaudeResultMessage;
  diagnostics: ClaudeOutputContractDiagnostics;
  structuredOutput: unknown;
} {
  let resultMessage: ClaudeResultMessage;
  try {
    resultMessage = parseClaudeResultMessage(stdout);
  } catch (error: unknown) {
    const diagnostics = malformedClaudeDiagnostics(
      stdout,
      schemaFingerprint,
      redactExcerpt,
    );
    throw new AgentTaskOutputContractError(
      "invalid-result-envelope",
      diagnostics,
      `${contractErrorMessage("invalid-result-envelope", diagnostics)}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const diagnostics = claudeDiagnostics(
    resultMessage,
    schemaFingerprint,
    redactExcerpt,
  );
  return {
    resultMessage,
    diagnostics,
    structuredOutput: resultMessage.structured_output,
  };
}

export function parseClaudeAgentTaskResult(
  stdout: string,
  redactExcerpt: (value: string) => string = (value) => value,
  contractVersion: 1 | 2 = 1,
): AgentTaskResultPayload | AgentTaskResultPayloadV2 {
  const schemaFingerprint =
    contractVersion === 2
      ? AGENT_TASK_CLAUDE_SCHEMA_V2_FINGERPRINT
      : AGENT_TASK_CLAUDE_SCHEMA_FINGERPRINT;
  const { resultMessage, diagnostics, structuredOutput } =
    parseClaudeContractInput(stdout, redactExcerpt, schemaFingerprint);
  if (resultMessage.is_error === true) {
    throw new AgentTaskOutputContractError(
      "is-error",
      diagnostics,
      contractErrorMessage("is-error", diagnostics),
    );
  }
  if (structuredOutput === undefined) {
    throw new AgentTaskOutputContractError(
      "missing-structured-output",
      diagnostics,
      contractErrorMessage("missing-structured-output", diagnostics),
    );
  }
  try {
    return parseAgentTaskResultPayload(
      structuredOutput,
      "claude",
      contractVersion,
    );
  } catch (error: unknown) {
    throw new AgentTaskOutputContractError(
      "invalid-structured-output",
      diagnostics,
      `${contractErrorMessage("invalid-structured-output", diagnostics)}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
