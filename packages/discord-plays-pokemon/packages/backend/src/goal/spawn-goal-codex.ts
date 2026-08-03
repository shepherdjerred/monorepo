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
import {
  buildCodexArgs,
  buildTracePrompt,
  type PromptContext,
} from "./codex-command.ts";
import { attachCodexTrace, type CodexTrace } from "./codex-trace.ts";
import { streamToLog } from "./goal-process-helpers.ts";
import type { GoalProcess, GoalProcessSpawner } from "./goal-types.ts";

export type SpawnGoalCodexInput = {
  config: Config["game"]["goal"];
  controlToken: string;
  goalId: string;
  goal: string;
  requestedBy: string;
  promptContext: PromptContext;
  spawner: GoalProcessSpawner;
  // Subscribed BEFORE the stdout pump starts so no early agent_message is
  // lost (post-spawn subscribers race the pump and can miss everything when
  // stdout drains fast). Used to forward milestones to Discord.
  onAgentMessage?: (text: string) => void;
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
  const configuredHelperDirectory =
    input.config.helper_dir ?? ".pokemon-goal-bin";
  const helperDirectory = path.isAbsolute(configuredHelperDirectory)
    ? configuredHelperDirectory
    : path.resolve(runtimeDirectory, configuredHelperDirectory);
  await Bun.write(path.join(screenshotDirectory, ".keep"), "", {
    createPath: true,
  });
  await prepareRuntimeTools(helperDirectory);
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
      goalId: input.goalId,
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
  // Archive both model-visible roles for blackbox review. The final command
  // argument alone contains only the untrusted user-role message.
  const trace = attachCodexTrace(jsonl, {
    goalId: input.goalId,
    goal: input.goal,
    model: input.config.model,
    requestedBy: input.requestedBy,
    gameStateSummary: input.promptContext.gameStateSummary,
    initialPrompt: buildTracePrompt(input.goal, input.promptContext),
  });
  const onAgentMessage = input.onAgentMessage;
  if (onAgentMessage !== undefined) {
    jsonl.subscribe((event) => {
      if (event.kind === "agent_message") {
        onAgentMessage(event.text);
      }
    });
  }
  // Drain stdout fully before reading jsonl.total() in observeProcess.
  const stdoutPump = pumpCodexStdout(process.stdout, jsonl);
  void streamToLog(process.stderr, "stderr");
  return { process, jsonl, stdoutPump, trace, outputPath };
}
