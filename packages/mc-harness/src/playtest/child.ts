/**
 * Playtest child process, spawned by the daemon so a hung or crashing
 * scenario never takes the daemon down.
 *
 *   bun child.ts describe <file>       prints ScenarioMeta JSON
 *   bun child.ts run <descriptor-json> writes <runDir>/report.json
 *
 * Exit codes for `run`: 0 passed, 1 failed, 2 errored or timed out.
 */
import { playtestExitCode } from "#protocol/playtest.ts";
import { DaemonClient } from "#playtest/daemon-client.ts";
import { RunDescriptorSchema, runScenario } from "#playtest/run.ts";
import { loadScenario, scenarioMeta } from "#playtest/scenario.ts";

const [mode, argument] = process.argv.slice(2);

async function main(): Promise<number> {
  if (argument === undefined) {
    throw new Error("usage: child.ts describe <file> | run <descriptor-json>");
  }
  if (mode === "describe") {
    const meta = scenarioMeta(await loadScenario(argument));
    process.stdout.write(`${JSON.stringify(meta)}\n`);
    return 0;
  }
  if (mode === "run") {
    const descriptor = RunDescriptorSchema.parse(JSON.parse(argument));
    const scenario = await loadScenario(descriptor.file);
    const report = await runScenario(
      scenario,
      descriptor,
      new DaemonClient(descriptor.targetId),
    );
    return playtestExitCode([report.status]);
  }
  throw new Error(`unknown mode ${String(mode)}`);
}

try {
  process.exit(await main());
} catch (error) {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exit(2);
}
