// LLM-observability wiring for agent-task subprocesses. Codex streams NDJSON
// we adapt into gen_ai spans live via the shared codex adapter; claude gets
// one post-hoc span parsed from stdout after exit. The archive span processor
// registered in observability/tracing.ts uploads both bodies to S3.

import { traceClaudeCli } from "@shepherdjerred/llm-observability/wrappers/claude-cli";
import { attachCodexTrace } from "@shepherdjerred/llm-observability/wrappers/codex";
import {
  createCodexJsonlParser,
  type CodexJsonlParser,
} from "@shepherdjerred/llm-observability/codex-jsonl";
import type { AgentTaskProvider } from "#shared/agent-task.ts";

export type AgentTaskLlmTrace = {
  /** Feed every subprocess stdout line (codex NDJSON events; no-op for claude). */
  pushStdoutLine: (line: string) => void;
  /**
   * Close streaming spans. Call in a `finally` around the subprocess await so
   * a crashed codex run still lands in Tempo with whatever turns completed.
   * Idempotent; no-op for claude.
   */
  close: () => void;
  /**
   * Emit the post-hoc claude span from the finished process's stdout. Call
   * before any failure checks — failed runs are traced too (they still spent
   * tokens). No-op for codex (its spans streamed live).
   */
  record: (outcome: {
    stdout: string;
    exitCode: number;
    startTimeMs: number;
    durationMs: number;
  }) => void;
};

export function startAgentTaskLlmTrace(args: {
  provider: AgentTaskProvider;
  callSite: string;
  model: string;
  prompt: string;
  options: Record<string, unknown>;
  warn: (message: string) => void;
}): AgentTaskLlmTrace {
  const logger = { warn: args.warn };

  const codexParser: CodexJsonlParser | undefined =
    args.provider === "codex" ? createCodexJsonlParser(logger) : undefined;
  const codexTrace =
    codexParser === undefined
      ? undefined
      : attachCodexTrace(codexParser, {
          service: "temporal",
          callSite: args.callSite,
          model: args.model,
          initialPrompt: args.prompt,
          logger,
        });

  return {
    pushStdoutLine(line: string): void {
      codexParser?.push(`${line}\n`);
    },
    close(): void {
      codexParser?.finish();
      codexTrace?.end();
    },
    record(outcome): void {
      if (args.provider !== "claude") return;
      traceClaudeCli(
        {
          service: "temporal",
          callSite: args.callSite,
          request: {
            model: args.model,
            prompt: args.prompt,
            options: args.options,
          },
        },
        {
          stdout: outcome.stdout,
          exitCode: outcome.exitCode,
          startTimeMs: outcome.startTimeMs,
          endTimeMs: outcome.startTimeMs + outcome.durationMs,
        },
        logger,
      );
    },
  };
}
