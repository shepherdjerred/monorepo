import { commandEventCorrelation } from "./command-correlation.ts";
import { captureTelemetryOperation } from "./controller-telemetry.ts";
import type { CommandRequest, CommandResult, FleetTelemetry } from "./ports.ts";
import { runCommand } from "./process-runner.ts";

export async function runRecordedCommand(
  request: CommandRequest,
  telemetry?: FleetTelemetry,
): Promise<CommandResult> {
  const startedAt = performance.now();
  const correlation = commandEventCorrelation(telemetry);
  captureTelemetryOperation("command.started", () =>
    telemetry?.record(
      "command.started",
      {
        executable: request.executable,
        args: request.args,
        cwd: request.cwd,
        timeoutMs: request.timeoutMs,
        maxOutputBytes: request.maxOutputBytes ?? null,
        hasStdin: request.stdin !== undefined,
        sensitiveOutput: request.sensitiveOutput === true,
        environmentNames: Object.keys(request.env ?? {}).sort(),
      },
      correlation,
    ),
  );
  let result: CommandResult;
  try {
    result = await runCommand(request);
  } catch (error) {
    captureTelemetryOperation("command.failed", () =>
      telemetry?.record(
        "command.failed",
        {
          executable: request.executable,
          durationMs: Math.round(performance.now() - startedAt),
          error: error instanceof Error ? error.message : String(error),
        },
        correlation,
      ),
    );
    throw error;
  }
  // A terminal telemetry failure is not a command failure. Keep this write
  // outside the operation catch so completed mutations are never mislabeled
  // and retried because capture failed.
  captureTelemetryOperation("command.completed", () =>
    telemetry?.record(
      "command.completed",
      {
        executable: request.executable,
        exitCode: result.exitCode,
        stdout: request.sensitiveOutput === true ? "[REDACTED]" : result.stdout,
        stderr: request.sensitiveOutput === true ? "[REDACTED]" : result.stderr,
        stdoutTruncated: result.stdoutTruncated === true,
        stderrTruncated: result.stderrTruncated === true,
        termination: result.termination,
        durationMs: Math.round(performance.now() - startedAt),
      },
      correlation,
    ),
  );
  return result;
}
