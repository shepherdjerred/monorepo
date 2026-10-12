import { z } from "zod";
import type { Usage } from "#evals/lib/types.ts";

export const AgentSchema = z.enum(["codex", "claude"]);
export type Agent = z.infer<typeof AgentSchema>;

export type AgentInvocation = {
  argv: string[];
  /** Extra environment for this agent (on top of the isolated task env). */
  env: Record<string, string>;
};

/**
 * The non-interactive command for one task. Both agents keep their own login:
 * Codex through the real CODEX_HOME, Claude Code through the real
 * CLAUDE_CONFIG_DIR. The runner never reads or forwards provider credentials;
 * the task environment inherits the operator's shell unchanged.
 */
export function agentInvocation(options: {
  agent: Agent;
  model: string | null;
  prompt: string;
  worktree: string;
  lastMessagePath: string;
  realHome: string;
}): AgentInvocation {
  const model = options.model === null ? [] : ["--model", options.model];
  if (options.agent === "codex") {
    return {
      argv: [
        "codex",
        "exec",
        ...model,
        "--dangerously-bypass-approvals-and-sandbox",
        "--json",
        "-C",
        options.worktree,
        "-o",
        options.lastMessagePath,
        options.prompt,
      ],
      env: { CODEX_HOME: `${options.realHome}/.codex` },
    };
  }
  return {
    argv: [
      "claude",
      "-p",
      options.prompt,
      ...model,
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ],
    env: { CLAUDE_CONFIG_DIR: `${options.realHome}/.claude` },
  };
}

function jsonLines(events: string): unknown[] {
  const parsed: unknown[] = [];
  for (const line of events.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      parsed.push(JSON.parse(trimmed));
    } catch {
      // A truncated final line (killed on timeout) is not an event.
    }
  }
  return parsed;
}

const CodexTurnSchema = z.object({
  type: z.literal("turn.completed"),
  usage: z.object({
    input_tokens: z.number(),
    cached_input_tokens: z.number().optional(),
    output_tokens: z.number(),
  }),
});

const ClaudeResultSchema = z.object({
  type: z.literal("result"),
  result: z.string().optional(),
  total_cost_usd: z.number().optional(),
  usage: z.object({
    input_tokens: z.number(),
    cache_read_input_tokens: z.number().optional(),
    cache_creation_input_tokens: z.number().optional(),
    output_tokens: z.number(),
  }),
});

/** Token usage summed over the agent's JSONL event stream; null when absent. */
export function parseUsage(agent: Agent, events: string): Usage | null {
  if (agent === "codex") {
    let usage: Usage | null = null;
    for (const event of jsonLines(events)) {
      const turn = CodexTurnSchema.safeParse(event);
      if (!turn.success) {
        continue;
      }
      usage ??= { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
      usage.inputTokens += turn.data.usage.input_tokens;
      usage.cachedInputTokens += turn.data.usage.cached_input_tokens ?? 0;
      usage.outputTokens += turn.data.usage.output_tokens;
    }
    return usage;
  }
  const result = jsonLines(events)
    .map((event) => ClaudeResultSchema.safeParse(event))
    .findLast((parsed) => parsed.success);
  if (result?.success !== true) {
    return null;
  }
  const { usage } = result.data;
  const cached =
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);
  return {
    inputTokens: usage.input_tokens + cached,
    cachedInputTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens,
    ...(result.data.total_cost_usd === undefined
      ? {}
      : { costUsd: result.data.total_cost_usd }),
  };
}

/** Claude prints its final answer in the result event; Codex writes it to `-o`. */
export function claudeLastMessage(events: string): string {
  const result = jsonLines(events)
    .map((event) => ClaudeResultSchema.safeParse(event))
    .findLast((parsed) => parsed.success);
  return result?.success === true ? (result.data.result ?? "") : "";
}
