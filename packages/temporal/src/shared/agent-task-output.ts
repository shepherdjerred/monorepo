import {
  AgentTaskFollowUpSchema,
  AgentTaskFollowUpV2Schema,
  AgentTaskOutputContractError,
  AgentTaskResultPayloadSchema,
  AgentTaskResultPayloadV2Schema,
  AgentTaskWireResultPayloadSchema,
  AgentTaskWireResultPayloadV2Schema,
  type AgentTaskFollowUp,
  type AgentTaskFollowUpV2,
  type AgentTaskOutputContractDiagnostics,
  type AgentTaskOutputContractFailureReason,
  type AgentTaskProvider,
  type AgentTaskResultPayload,
  type AgentTaskResultPayloadV2,
  type AgentTaskWireResultPayload,
  type AgentTaskWireResultPayloadV2,
} from "./agent-task.ts";

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

export function boundedFinalTextExcerpt(
  result: string | undefined,
  redact: (value: string) => string,
): string | undefined {
  if (result === undefined) {
    return undefined;
  }
  const normalized = redact(result).replaceAll(/\s+/g, " ").trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 240)}…`;
}

function contractErrorMessage(
  provider: AgentTaskProvider,
  reason: AgentTaskOutputContractFailureReason,
  diagnostics: AgentTaskOutputContractDiagnostics,
): string {
  return [
    `${provider} structured-output contract failure: ${reason}`,
    `schemaFingerprint=${diagnostics.schemaFingerprint}`,
    `finalTextExcerpt=${diagnostics.finalTextExcerpt ?? "(none)"}`,
  ].join(" ");
}

/**
 * Validate the structured output a native agent SDK returned for its declared
 * output schema. Prose is never a fallback: a run that finished without
 * schema-valid structured output is a contract failure, not a partial result.
 */
export function parseAgentTaskStructuredOutput(input: {
  provider: AgentTaskProvider;
  structuredOutput: unknown;
  contractVersion: 1 | 2;
  schemaFingerprint: string;
  finalText: string | undefined;
  redactExcerpt: (value: string) => string;
}): AgentTaskResultPayload | AgentTaskResultPayloadV2 {
  const diagnostics: AgentTaskOutputContractDiagnostics = {
    schemaFingerprint: input.schemaFingerprint,
    finalTextExcerpt: boundedFinalTextExcerpt(
      input.finalText,
      input.redactExcerpt,
    ),
  };
  if (input.structuredOutput === undefined) {
    throw new AgentTaskOutputContractError(
      "missing-structured-output",
      diagnostics,
      contractErrorMessage(
        input.provider,
        "missing-structured-output",
        diagnostics,
      ),
    );
  }
  try {
    return parseAgentTaskResultPayload(
      input.structuredOutput,
      input.provider,
      input.contractVersion,
    );
  } catch (error: unknown) {
    throw new AgentTaskOutputContractError(
      "invalid-structured-output",
      diagnostics,
      `${contractErrorMessage(input.provider, "invalid-structured-output", diagnostics)}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
