import type { AgentTaskInput } from "./agent-task.ts";

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value).toSorted(([a], [b]) =>
      a.localeCompare(b),
    )) {
      sorted[key] = sortJson(entryValue);
    }
    return sorted;
  }
  return value;
}

async function shortSha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  const bytes = new Uint8Array(digest);
  return Array.from(bytes.slice(0, 10), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function sanitizeTemporalIdPart(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function agentTaskWorkflowId(
  input: AgentTaskInput,
): Promise<string> {
  const prefix = sanitizeTemporalIdPart(input.title) || "agent-task";
  const key =
    input.idempotencyKey ??
    JSON.stringify(
      sortJson({
        provider: input.provider,
        agentTimeoutMinutes: input.agentTimeoutMinutes,
        title: input.title,
        prompt: input.prompt,
        runAt: input.runAt,
        repo: input.repo,
        source: input.source,
      }),
    );
  return `agent-task-${prefix}-${await shortSha256(key)}`;
}

export const DYNAMIC_AGENT_TASK_MEMO_KEY = "dynamicAgentTask";

export async function agentTaskScheduleId(
  input: AgentTaskInput,
): Promise<string> {
  if (input.scheduleId !== undefined) return input.scheduleId;
  const prefix = sanitizeTemporalIdPart(input.title) || "agent-task";
  const key =
    input.idempotencyKey ??
    JSON.stringify(
      sortJson({
        provider: input.provider,
        agentTimeoutMinutes: input.agentTimeoutMinutes,
        title: input.title,
        prompt: input.prompt,
        cron: input.cron,
        repo: input.repo,
        source: input.source,
      }),
    );
  return `agent-task-${prefix}-${await shortSha256(key)}`;
}
