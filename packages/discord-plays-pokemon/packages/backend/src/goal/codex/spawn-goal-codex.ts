// Runs the Codex SDK goal turn and adapts its event stream to the historical
// process-like lifecycle plus additive v2 codex.jsonl representation.

import path from "node:path";
import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import { logger } from "#src/logger.ts";
import type { Config } from "#src/config/schema.ts";
import {
  createCodexJsonlParser,
  type CodexJsonlParser,
} from "@shepherdjerred/llm-observability/codex-jsonl";
import {
  prepareRuntimeTools,
  buildEnvironment,
} from "#src/goal/goal-runtime-env.ts";
import {
  buildDeveloperInstructions,
  buildTracePrompt,
  buildUserPrompt,
  type PromptContext,
} from "./codex-command.ts";
import { attachCodexTrace, type CodexTrace } from "./codex-trace.ts";
import type { GoalProcess, GoalProcessSpawner } from "#src/goal/goal-types.ts";

export const CODEX_JSONL_SCHEMA_VERSION = 2;

export type SpawnGoalCodexInput = {
  config: Config["game"]["goal"];
  controlToken: string;
  goalId: string;
  goal: string;
  requestedBy: string;
  promptContext: PromptContext;
  spawner: GoalProcessSpawner | undefined;
  onAgentMessage?: (text: string) => void;
  onEventLine: ((line: string) => Promise<void> | void) | undefined;
};

export type SpawnedGoalCodex = {
  process: GoalProcess;
  jsonl: CodexJsonlParser;
  stdoutPump: Promise<void>;
  trace: CodexTrace;
  outputPath: string;
};

function codexEventLine(event: ThreadEvent): string {
  return JSON.stringify({
    ...event,
    schema_version: CODEX_JSONL_SCHEMA_VERSION,
    transport: "codex_sdk",
  });
}

function fixtureProcess(
  input: SpawnGoalCodexInput,
  outputPath: string,
  runtimeDirectory: string,
  environment: Record<string, string>,
): GoalProcess | undefined {
  if (input.spawner === undefined) {
    return undefined;
  }
  return input.spawner(
    ["codex-sdk-fixture", "--output-last-message", outputPath],
    { cwd: runtimeDirectory, env: environment },
  );
}

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
  const environment = buildEnvironment({
    runtimeDirectory,
    helperDirectory,
    controlHost: input.config.control_host,
    controlPort: input.config.control_port,
    controlToken: input.controlToken,
    goalId: input.goalId,
  });
  const jsonl = createCodexJsonlParser({
    warn: (message) => {
      logger.warn(message);
    },
    info: (message) => {
      logger.info(message);
    },
  });
  const trace = attachCodexTrace(jsonl, {
    goalId: input.goalId,
    goal: input.goal,
    model: input.config.model,
    requestedBy: input.requestedBy,
    gameStateSummary: input.promptContext.gameStateSummary,
    initialPrompt: buildTracePrompt(input.goal, input.promptContext),
  });
  if (input.onAgentMessage !== undefined) {
    jsonl.subscribe((event) => {
      if (event.kind === "agent_message") {
        input.onAgentMessage?.(event.text);
      }
    });
  }

  const fixture = fixtureProcess(
    input,
    outputPath,
    runtimeDirectory,
    environment,
  );
  if (fixture !== undefined) {
    const stdoutPump =
      fixture.stdout === null
        ? Promise.resolve()
        : (async () => {
            const text = await new Response(fixture.stdout).text();
            for (const line of text.split("\n")) {
              if (line.length > 0) {
                jsonl.push(`${line}\n`);
                await input.onEventLine?.(line);
              }
            }
            jsonl.finish();
          })();
    const process: GoalProcess = {
      stdout: fixture.stdout,
      stderr: fixture.stderr,
      exited: (async () => {
        const exitCode = await fixture.exited;
        await stdoutPump;
        return exitCode;
      })(),
      kill() {
        fixture.kill();
      },
    };
    return { process, jsonl, stdoutPump, trace, outputPath };
  }

  const abortController = new AbortController();
  const execution = (async (): Promise<number> => {
    let finalResponse = "";
    try {
      const streamed = await trace.run(async () => {
        const codex = new Codex({
          env: environment,
          config: {
            developer_instructions: buildDeveloperInstructions(),
            project_doc_max_bytes: 0,
            features: {
              apps: false,
              plugins: false,
              multi_agent: false,
            },
          },
        });
        const thread = codex.startThread({
          approvalPolicy: "never",
          model: input.config.model,
          modelReasoningEffort: input.config.reasoning_effort,
          networkAccessEnabled: true,
          sandboxMode: "danger-full-access",
          skipGitRepoCheck: true,
          webSearchMode: "disabled",
          workingDirectory: runtimeDirectory,
        });
        return await thread.runStreamed(
          buildUserPrompt(input.goal, input.promptContext),
          { signal: abortController.signal },
        );
      });
      for await (const event of streamed.events) {
        const line = codexEventLine(event);
        jsonl.push(`${line}\n`);
        await input.onEventLine?.(line);
        if (
          event.type === "item.completed" &&
          event.item.type === "agent_message"
        ) {
          finalResponse = event.item.text;
        }
        if (event.type === "turn.failed") {
          throw new Error(event.error.message);
        }
        if (event.type === "error") {
          throw new Error(event.message);
        }
      }
      // A stream that ends without an agent_message produced no report. Exit
      // code 0 would make GoalManager mark the goal `completed` and announce
      // it in Discord while readFinalReport says Codex wrote nothing, so treat
      // the missing final message as a provider failure instead.
      if (finalResponse.trim() === "") {
        throw new Error(
          "Codex SDK stream completed without a final agent message",
        );
      }
      await Bun.write(outputPath, finalResponse, { createPath: true });
      return 0;
    } catch (error: unknown) {
      logger.error(
        `goal Codex SDK failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return abortController.signal.aborted ? 143 : 1;
    } finally {
      jsonl.finish();
    }
  })();
  const process: GoalProcess = {
    stdout: null,
    stderr: null,
    exited: execution,
    kill() {
      abortController.abort(new Error("Pokémon goal SDK run cancelled"));
    },
  };
  return {
    process,
    jsonl,
    stdoutPump: Promise.resolve(),
    trace,
    outputPath,
  };
}
