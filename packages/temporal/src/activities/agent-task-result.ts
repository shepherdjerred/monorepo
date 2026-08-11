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
} from "#shared/agent-task.ts";
import {
  parseAgentTaskResultPayload,
  parseClaudeAgentTaskResult,
} from "#shared/agent-task-output.ts";
import { captureWithContext, jsonLog } from "./agent-task-runtime.ts";

type DecodeAgentTaskPayloadInput = {
  provider: AgentTaskProvider;
  stdout: string;
  outputPath: string | undefined;
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

async function providerPayload(
  input: DecodeAgentTaskPayloadInput,
): Promise<AgentTaskResultPayload | AgentTaskResultPayloadV2> {
  if (input.provider === "claude") {
    return parseClaudeAgentTaskResult(
      input.stdout,
      input.redact,
      input.contractVersion,
    );
  }
  if (input.outputPath === undefined) {
    throw new Error("Codex agent task completed without an output path");
  }
  return parseAgentTaskResultPayload(
    await Bun.file(input.outputPath).text(),
    input.provider,
    input.contractVersion,
  );
}

export async function decodeAgentTaskPayload(
  input: DecodeAgentTaskPayloadInput,
): Promise<AgentTaskResultPayload | AgentTaskResultPayloadV2> {
  try {
    const redacted = redactAgentTaskPayloadStrings(
      await providerPayload(input),
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
      resultSubtype: contractDiagnostics?.resultSubtype,
      resultMessageKeys: contractDiagnostics?.resultMessageKeys,
      finalTextExcerpt: contractDiagnostics?.finalTextExcerpt,
    });
    throw error;
  }
}
