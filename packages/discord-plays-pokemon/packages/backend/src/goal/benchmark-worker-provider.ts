import path from "node:path";
import type { GoalManager } from "./goal-manager.ts";
import {
  BENCHMARK_PROVIDER_STARTUP_FAILURE_FILE,
  BenchmarkProviderStartupFailureSchema,
} from "./benchmark-provider-failure.ts";

type StartBenchmarkGoalInput = {
  manager: GoalManager;
  goal: string;
  runDirectory: string;
};

export async function startBenchmarkGoal(
  input: StartBenchmarkGoalInput,
): Promise<void> {
  try {
    const started = await input.manager.startGoal({
      goal: input.goal,
      requesterId: "benchmark-operator",
      channelId: "benchmark",
    });
    if (started.kind !== "started") {
      throw new Error(
        `goal did not start: ${started.kind}: ${started.content}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = BenchmarkProviderStartupFailureSchema.parse({
      schemaVersion: 1,
      phase: "startup",
      message,
    });
    await Bun.write(
      path.join(input.runDirectory, BENCHMARK_PROVIDER_STARTUP_FAILURE_FILE),
      `${JSON.stringify(failure, undefined, 2)}\n`,
    );
    throw error;
  }
}
