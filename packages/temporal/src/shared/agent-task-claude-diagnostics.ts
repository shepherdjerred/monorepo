import { z } from "zod/v4";
import type { ClaudeResultMessage } from "./claude-result.ts";
import type {
  AgentTaskOutputContractFailureReason,
  ClaudeOutputContractDiagnostics,
} from "./agent-task.ts";

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

export function claudeDiagnostics(
  resultMessage: ClaudeResultMessage,
  schemaFingerprint: string,
  redact: (value: string) => string,
): ClaudeOutputContractDiagnostics {
  return {
    resultSubtype: resultMessage.subtype,
    resultMessageKeys: Object.keys(resultMessage).toSorted(),
    schemaFingerprint,
    finalTextExcerpt: boundedFinalTextExcerpt(resultMessage.result, redact),
  };
}

export function contractErrorMessage(
  reason: AgentTaskOutputContractFailureReason,
  diagnostics: ClaudeOutputContractDiagnostics,
): string {
  const excerpt = diagnostics.finalTextExcerpt ?? "(none)";
  const reasonDescription = reason === "is-error" ? "is_error=true" : reason;
  return [
    `claude structured-output contract failure: ${reasonDescription}`,
    `subtype=${diagnostics.resultSubtype ?? "(none)"}`,
    `resultMessageKeys=${diagnostics.resultMessageKeys.join(",")}`,
    `schemaFingerprint=${diagnostics.schemaFingerprint}`,
    `finalTextExcerpt=${excerpt}`,
  ].join(" ");
}

function lastJsonRecord(stdout: string): Record<string, unknown> | undefined {
  const candidates = stdout.trim().split("\n");
  let lastRecord: Record<string, unknown> | undefined;
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate.trim());
      const record = z.record(z.string(), z.unknown()).safeParse(parsed);
      if (record.success) {
        lastRecord = record.data;
      }
    } catch {
      // Diagnostics must never turn malformed provider output into a second
      // parser failure; the contract error remains the primary signal.
    }
  }
  return lastRecord;
}

export function malformedClaudeDiagnostics(
  stdout: string,
  schemaFingerprint: string,
  redact: (value: string) => string,
): ClaudeOutputContractDiagnostics {
  const record = lastJsonRecord(stdout);
  const resultSubtype =
    typeof record?.["subtype"] === "string" ? record["subtype"] : undefined;
  const result =
    typeof record?.["result"] === "string" ? record["result"] : undefined;
  return {
    resultSubtype,
    resultMessageKeys:
      record === undefined ? [] : Object.keys(record).toSorted(),
    schemaFingerprint,
    finalTextExcerpt:
      result === undefined
        ? undefined
        : boundedFinalTextExcerpt(result, redact),
  };
}
