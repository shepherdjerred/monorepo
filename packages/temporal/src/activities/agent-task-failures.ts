import { ApplicationFailure } from "@temporalio/activity";
import type { AgentTaskProvider } from "#shared/agent-task.ts";
import type { TrackedAgentResult } from "#shared/agent-subprocess.ts";

/** Auth/quota failures will not heal on Temporal retry. */
export function isNonRetryableAgentFailure(
  lastLine: string | undefined,
): boolean {
  if (lastLine === undefined || lastLine.length === 0) {
    return false;
  }
  const lower = lastLine.toLowerCase();
  return (
    lower.includes("401 unauthorized") ||
    lower.includes("missing bearer") ||
    lower.includes('api_error_status":401') ||
    lower.includes('api_error_status":429') ||
    lower.includes("weekly limit") ||
    lower.includes("rate limit") ||
    lower.includes("insufficient_quota") ||
    lower.includes("invalid_api_key")
  );
}

export function truncateLastLine(
  lastLine: string | undefined,
  max = 280,
): string {
  if (lastLine === undefined || lastLine.length === 0) {
    return "";
  }
  const oneLine = lastLine.replaceAll(/\s+/g, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max)}…`;
}

export function agentSubprocessFailure(
  provider: AgentTaskProvider,
  result: TrackedAgentResult,
): Error {
  const snippet = truncateLastLine(result.lastLine);
  const base = `${provider} agent task exited with code ${String(result.exitCode)} (signal=${result.signal}, durationMs=${String(result.durationMs)})`;
  const message = snippet.length > 0 ? `${base}: ${snippet}` : base;
  if (isNonRetryableAgentFailure(result.lastLine)) {
    return ApplicationFailure.create({
      message,
      nonRetryable: true,
      type: "AgentAuthOrQuotaFailure",
    });
  }
  return new Error(message);
}
