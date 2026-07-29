import type { CodexJsonlParser } from "@shepherdjerred/llm-observability/codex-jsonl";
import type { GoalProcess, GoalState } from "./goal-types.ts";
import type { CodexTrace } from "./codex-trace.ts";

export type ActiveGoal = {
  state: GoalState;
  process: GoalProcess;
  timeout: ReturnType<typeof setTimeout>;
  lastProgressSentAt: number;
  outputPath: string;
  jsonl: CodexJsonlParser;
  stdoutPump: Promise<void>;
  trace: CodexTrace;
  releaseInputLease: () => void;
};
