// Spawns the Codex goal process and wires JSONL → OTel blackbox tracing.
// Kept out of GoalManager so that file stays under the max-lines lint cap.

import path from "node:path";
import { logger } from "#src/logger.ts";
import type { Config } from "#src/config/schema.ts";
import {
  createCodexJsonlParser,
  pumpCodexStdout,
  type CodexJsonlParser,
} from "@shepherdjerred/llm-observability/codex-jsonl";
import { prepareRuntimeTools, buildEnvironment } from "./goal-runtime-env.ts";
import { buildCodexArgs, type PromptContext } from "./codex-command.ts";
import { attachCodexTrace, type CodexTrace } from "./codex-trace.ts";
import { streamToLog } from "./goal-process-helpers.ts";
import type { GoalProcess, GoalProcessSpawner } from "./goal-manager.ts";

export type SpawnGoalCodexInput = {
  config: Config["game"]["goal"];
  controlToken: string;
  goalId: string;
  goal: string;
  requestedBy: string;
  promptContext: PromptContext;
  spawner: GoalProcessSpawner;
};

export type SpawnedGoalCodex = {
  process: GoalProcess;
  jsonl: CodexJsonlParser;
  stdoutPump: Promise<void>;
  trace: CodexTrace;
  outputPath: string;
};

export async function spawnGoalCodex(
  input: SpawnGoalCodexInput,
): Promise<SpawnedGoalCodex> {
  const runtimeDirectory = path.resolve(input.config.runtime_directory);
  const screenshotDirectory = path.isAbsolute(input.config.screenshot_dir)
    ? input.config.screenshot_dir
    : path.resolve(runtimeDirectory, input.config.screenshot_dir);
  await Bun.write(path.join(screenshotDirectory, ".keep"), "", {
    createPath: true,
  });
  const helperDirectory = await prepareRuntimeTools(runtimeDirectory);
  const outputPath = path.join(
    screenshotDirectory,
    `${input.goalId}-final.txt`,
  );
  const args = buildCodexArgs({
    config: {
      codexBinary: input.config.codex_binary,
      model: input.config.model,
      reasoningEffort: input.config.reasoning_effort,
    },
    goal: input.goal,
    runtimeDirectory,
    outputPath,
    context: input.promptContext,
  });
  const process = input.spawner(args, {
    cwd: runtimeDirectory,
    env: buildEnvironment({
      runtimeDirectory,
      helperDirectory,
      controlHost: input.config.control_host,
      controlPort: input.config.control_port,
      controlToken: input.controlToken,
    }),
  });
  const jsonl = createCodexJsonlParser({
    warn: (message) => {
      logger.warn(message);
    },
    info: (message) => {
      logger.info(message);
    },
  });
  // Full Codex prompt (last arg) archived on the root span for blackbox review.
  const trace = attachCodexTrace(jsonl, {
    goalId: input.goalId,
    goal: input.goal,
    model: input.config.model,
    requestedBy: input.requestedBy,
    gameStateSummary: input.promptContext.gameStateSummary,
    initialPrompt: args.at(-1) ?? "",
  });
  // Drain stdout fully before reading jsonl.total() in observeProcess.
  const stdoutPump = pumpCodexStdout(process.stdout, jsonl);
  void streamToLog(process.stderr, "stderr");
  return { process, jsonl, stdoutPump, trace, outputPath };
}
