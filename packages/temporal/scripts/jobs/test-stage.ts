import path from "node:path";
import { z } from "zod";
import {
  suiteUsesVitest,
  TestStageInputSchema,
  testStageResult,
} from "#lib/delivery/test-stage.ts";
import type { DeliveryJobRequest } from "#shared/delivery-job.ts";

const REPORT_PATH = "/workspace/tmp/test-report.json";

/**
 * Runs one package script in the frozen checkout. Vitest suites get the JSON
 * reporter so the result carries counts and a report digest; other suites
 * report their exit code only. Output is bounded before it leaves the Job.
 */
export async function runTestStage(
  request: DeliveryJobRequest,
  options: {
    root?: string;
    spawn?: (argv: string[], cwd: string) => Promise<number>;
    now?: () => number;
  } = {},
) {
  const input = TestStageInputSchema.parse(request.input);
  const root = options.root ?? "/workspace/source";
  const workspace = path.join(root, input.workspace);
  const manifest = z
    .object({ scripts: z.record(z.string(), z.string()).default({}) })
    .loose()
    .parse(await Bun.file(path.join(workspace, "package.json")).json());
  const script = manifest.scripts[input.suite];
  if (script === undefined)
    throw new Error(
      `Workspace ${input.workspace} has no ${input.suite} script to run`,
    );
  const vitest = suiteUsesVitest(script);
  const argv = [
    "bun",
    "run",
    input.suite,
    ...(vitest
      ? [
          "--",
          "--reporter=default",
          "--reporter=json",
          `--outputFile=${REPORT_PATH}`,
        ]
      : []),
  ];
  const now = options.now ?? Date.now;
  const started = now();
  const spawn =
    options.spawn ??
    (async (command: string[], cwd: string) => {
      const child = Bun.spawn(command, {
        cwd,
        stdout: "inherit",
        stderr: "inherit",
        env: Object.fromEntries(
          Object.entries(Bun.env).filter(
            ([key]) => key !== "OP_SERVICE_ACCOUNT_TOKEN",
          ),
        ),
      });
      return await child.exited;
    });
  const exitCode = await spawn(argv, workspace);
  const durationMs = Math.max(0, now() - started);
  const reportFile = Bun.file(REPORT_PATH);
  const report =
    vitest && (await reportFile.exists())
      ? new Uint8Array(await reportFile.arrayBuffer())
      : null;
  if (vitest && report === null)
    throw new Error("Vitest suite produced no JSON report");
  return testStageResult({
    suite: input.suite,
    workspace: input.workspace,
    exitCode,
    durationMs,
    report,
  });
}
