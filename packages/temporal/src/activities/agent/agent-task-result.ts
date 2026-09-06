import { z } from "zod/v4";
import {
  agentTaskOutputContractFailuresTotal,
  agentTaskRunsTotal,
} from "#observability/metrics.ts";
import {
  AgentTaskOutputContractError,
  type AgentTaskProvider,
  type AgentTaskResultPayload,
  AgentTaskResultPayloadSchema,
  type AgentTaskResultPayloadV2,
  AgentTaskResultPayloadV2Schema,
} from "#shared/agent/agent-task.ts";
import { parseAgentTaskStructuredOutput } from "#shared/agent/agent-task-output.ts";
import { captureWithContext, jsonLog } from "./agent-task-runtime.ts";

type DecodeAgentTaskPayloadInput = {
  provider: AgentTaskProvider;
  structuredOutput: unknown;
  finalText: string | undefined;
  schemaFingerprint: string;
  contractVersion: 1 | 2;
  durationMs: number;
  redact: (value: string) => string;
};

export function redactAgentTaskPayloadStrings(
  value: unknown,
  redact: (value: string) => string,
): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) {
    return value.map((entry) => redactAgentTaskPayloadStrings(entry, redact));
  }
  const record = z.record(z.string(), z.unknown()).safeParse(value);
  if (!record.success) return value;
  return Object.fromEntries(
    Object.entries(record.data).map(([key, entry]) => [
      key,
      redactAgentTaskPayloadStrings(entry, redact),
    ]),
  );
}

export function decodeAgentTaskPayload(
  input: DecodeAgentTaskPayloadInput,
): AgentTaskResultPayload | AgentTaskResultPayloadV2 {
  try {
    const redacted = redactAgentTaskPayloadStrings(
      parseAgentTaskStructuredOutput({
        provider: input.provider,
        structuredOutput: input.structuredOutput,
        contractVersion: input.contractVersion,
        schemaFingerprint: input.schemaFingerprint,
        finalText: input.finalText,
        redactExcerpt: input.redact,
      }),
      input.redact,
    );
    return input.contractVersion === 2
      ? AgentTaskResultPayloadV2Schema.parse(redacted)
      : AgentTaskResultPayloadSchema.parse(redacted);
  } catch (error: unknown) {
    agentTaskRunsTotal.inc({
      provider: input.provider,
      outcome: "parse_failed",
    });
    const contractDiagnostics =
      error instanceof AgentTaskOutputContractError
        ? error.diagnostics
        : undefined;
    if (error instanceof AgentTaskOutputContractError) {
      agentTaskOutputContractFailuresTotal.inc({
        provider: input.provider,
        reason: error.reason,
      });
      jsonLog("warning", "Agent task output contract failed", {
        provider: input.provider,
        outputContractReason: error.reason,
        ...error.diagnostics,
      });
    }
    captureWithContext(error, {
      provider: input.provider,
      durationMs: input.durationMs,
      phase: "parse-output",
      schemaFingerprint: contractDiagnostics?.schemaFingerprint,
      outputContractReason:
        error instanceof AgentTaskOutputContractError
          ? error.reason
          : undefined,
      finalTextExcerpt: contractDiagnostics?.finalTextExcerpt,
    });
    throw error;
  }
}
