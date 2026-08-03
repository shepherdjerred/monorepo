import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { runRecordedCommand } from "@shepherdjerred/pr-fleet-controller/src/recorded-command.ts";
import { runRecordedWorkerAttempt } from "@shepherdjerred/pr-fleet-controller/src/recorded-worker-attempt.ts";
import type { FleetTelemetry } from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
import type {
  RunEventCorrelation,
  RunEventKind,
} from "@shepherdjerred/pr-fleet-controller/src/run-events.ts";

class TerminalFailingTelemetry implements FleetTelemetry {
  readonly runId = "terminal-failure-test";
  readonly events: RunEventKind[] = [];
  readonly #failedKind: RunEventKind;
  readonly #failure: Error;
  #nextId = 0;

  constructor(failedKind: RunEventKind, failure: Error) {
    this.#failedKind = failedKind;
    this.#failure = failure;
  }

  newId(prefix: string): string {
    this.#nextId += 1;
    return `${prefix}-${String(this.#nextId)}`;
  }

  traceId(): string {
    return "0".repeat(32);
  }

  record(
    kind: RunEventKind,
    _payload: Record<string, unknown>,
    _correlation: RunEventCorrelation = {},
  ): void {
    if (kind === this.#failedKind) {
      throw this.#failure;
    }
    this.events.push(kind);
  }
}

describe("terminal recording failure boundaries", () => {
  test("does not relabel a completed command as failed", async () => {
    const failure = new Error("command completion capture failed");
    const telemetry = new TerminalFailingTelemetry(
      "command.completed",
      failure,
    );

    expect(
      runRecordedCommand(
        {
          executable: process.execPath,
          args: ["-e", "process.stdout.write('completed')"],
          cwd: tmpdir(),
          timeoutMs: 30_000,
        },
        telemetry,
      ),
    ).rejects.toBe(failure);
    expect(telemetry.events).toEqual(["command.started"]);
  });

  test("does not retry a completed worker attempt", async () => {
    const failure = new Error("worker completion capture failed");
    const telemetry = new TerminalFailingTelemetry(
      "worker.attempt.completed",
      failure,
    );
    let operationRuns = 0;

    expect(
      runRecordedWorkerAttempt({
        attempt: 1,
        prompt: "work once",
        telemetry,
        correlation: { modelTurnId: "worker-turn-1" },
        run: async () => {
          operationRuns += 1;
          return { state: "waiting-ci" };
        },
      }),
    ).rejects.toBe(failure);
    expect(operationRuns).toBe(1);
    expect(telemetry.events).toEqual(["worker.attempt.started"]);
  });

  test("returns operation failures for the caller's bounded retry", async () => {
    const operationFailure = new Error("schema validation failed");
    const telemetry = new TerminalFailingTelemetry(
      "run.failed",
      new Error("unused"),
    );

    const outcome = await runRecordedWorkerAttempt({
      attempt: 1,
      prompt: "invalid response",
      telemetry,
      correlation: { modelTurnId: "worker-turn-1" },
      run: async () => {
        throw operationFailure;
      },
    });

    expect(outcome).toEqual({ status: "failed", error: operationFailure });
    expect(telemetry.events).toEqual([
      "worker.attempt.started",
      "worker.attempt.failed",
    ]);
  });
});
