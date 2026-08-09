import { describe, expect, test } from "bun:test";
import {
  coerceWorkerResult,
  MastraMaster,
} from "@shepherdjerred/pr-fleet-controller/src/agents.ts";
import type { WorkerResult } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import type { MasterControllerTools } from "@shepherdjerred/pr-fleet-controller/src/master-tools.ts";
import type {
  FleetObserver,
  FleetTelemetry,
} from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
import type {
  RunEventCorrelation,
  RunEventKind,
} from "@shepherdjerred/pr-fleet-controller/src/run-events.ts";
import type { FleetSnapshot } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";

const snapshot: FleetSnapshot = {
  open: 0,
  green: 0,
  active: 0,
  queued: 0,
  pending: 0,
  waiting: 0,
  paused: 0,
  prs: [],
};

const noop = (): void => {
  // test stub — intentionally does nothing
};

const controller: MasterControllerTools = {
  snapshot: () => snapshot,
  tick: () =>
    Promise.resolve({
      trigger: "user",
      snapshot,
      changes: [],
      nextHeartbeatSeconds: 300,
    }),
  prioritize: noop,
  pause: noop,
  resume: noop,
  guide: noop,
  setWorkerLimit: noop,
};

class RecordingObserver implements FleetObserver {
  readonly text: string[] = [];
  readonly changes: string[] = [];
  onSnapshot(): void {
    // test stub — the shutdown assertions do not inspect snapshots
  }
  onChange(change: string): void {
    this.changes.push(change);
  }
  onMasterText(text: string): void {
    this.text.push(text);
  }
}

class RecordingTelemetry implements FleetTelemetry {
  readonly runId = "master-abort-test";
  readonly events: {
    kind: RunEventKind;
    payload: Record<string, unknown>;
    correlation: RunEventCorrelation;
  }[] = [];

  newId(prefix: string): string {
    return `${prefix}-test`;
  }

  traceId(): string {
    return "a".repeat(32);
  }

  record(
    kind: RunEventKind,
    payload: Record<string, unknown>,
    correlation: RunEventCorrelation = {},
  ): void {
    this.events.push({ kind, payload, correlation });
  }
}

// A master whose streamed turn hangs until its abort signal fires, standing in
// for a long remote model turn without a live model.
class HangingMaster extends MastraMaster {
  capturedSignal: AbortSignal | null = null;
  turns = 0;

  protected override streamTurn(
    _prompt: string,
    signal: AbortSignal,
  ): Promise<{ textStream: AsyncIterable<string> }> {
    this.turns += 1;
    this.capturedSignal = signal;
    const textStream = (async function* (): AsyncGenerator<string> {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => {
          resolve();
        });
      });
      // A real turn would emit text; this stub hangs until abort and then
      // completes without emitting. The unreachable yield documents the shape
      // and satisfies the generator contract.
      if (!signal.aborted) {
        yield "unreachable when aborted";
      }
    })();
    return Promise.resolve({ textStream });
  }
}

class PartialOutputMaster extends MastraMaster {
  protected override streamTurn(
    _prompt: string,
    signal: AbortSignal,
  ): Promise<{ textStream: AsyncIterable<string> }> {
    const textStream = (async function* (): AsyncGenerator<string> {
      yield "visible partial output";
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => {
          resolve();
        });
      });
    })();
    return Promise.resolve({ textStream });
  }
}

class CompletedMaster extends MastraMaster {
  protected override streamTurn(): Promise<{
    textStream: AsyncIterable<string>;
  }> {
    const textStream = (async function* (): AsyncGenerator<string> {
      yield "completed output";
    })();
    return Promise.resolve({ textStream });
  }
}

class KindFailingTelemetry extends RecordingTelemetry {
  readonly #failedKind: RunEventKind;

  constructor(failedKind: RunEventKind) {
    super();
    this.#failedKind = failedKind;
  }

  override record(
    kind: RunEventKind,
    payload: Record<string, unknown>,
    correlation: RunEventCorrelation = {},
  ): void {
    if (kind === this.#failedKind) {
      throw new Error("state volume is full");
    }
    super.record(kind, payload, correlation);
  }
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 5));

describe("coerceWorkerResult", () => {
  const validResult: WorkerResult = {
    pr: 42,
    state: "waiting-ci",
    headShaBefore: "a".repeat(40),
    headShaAfter: null,
    hardFailures: [],
    reviewFindings: [],
    conflict: false,
    validation: [],
    lastAction: "observed CI",
    blockers: [],
    worktree: "/tmp/pr-fleet-42",
    worktreeDirty: false,
    setupLeaseReleased: true,
    heavyLeaseReleased: true,
    writeLeaseReleased: true,
  };

  test("returns the validated object when present", () => {
    expect(coerceWorkerResult({ object: validResult })).toEqual({
      ...validResult,
      operatorRequestId: null,
    });
  });

  test("throws a legible error (not a raw Zod dump) when object is undefined", () => {
    expect(() =>
      coerceWorkerResult({ object: undefined, text: "  ran out of steps  " }),
    ).toThrow(
      /Worker produced no structured result.*Final model text: ran out of steps/s,
    );
  });

  test("omits the final-text clause when there is no model text", () => {
    let message = "";
    try {
      coerceWorkerResult({ object: undefined });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Worker produced no structured result");
    expect(message).not.toContain("Final model text");
  });

  test("still rejects a present-but-invalid object", () => {
    expect(() => coerceWorkerResult({ object: { pr: 1 } })).toThrow();
  });
});

describe("master shutdown", () => {
  test("aborts and awaits the in-flight master turn before resolving", async () => {
    const observer = new RecordingObserver();
    const master = new HangingMaster("openai/gpt-5", controller, observer, {
      onFatalError: noop,
      requestShutdown: noop,
    });

    master.send("status?");
    await flush();
    expect(master.turns).toBe(1);
    expect(master.capturedSignal?.aborted).toBe(false);

    await master.stop();
    // Shutdown aborted the active turn and its await settled (stop resolved),
    // and an aborted turn is not reported as a failure.
    expect(master.capturedSignal?.aborted).toBe(true);
    expect(observer.changes).toEqual([]);
  });

  test("drops steering queued after shutdown instead of starting a new turn", async () => {
    const observer = new RecordingObserver();
    const master = new HangingMaster("openai/gpt-5", controller, observer, {
      onFatalError: noop,
      requestShutdown: noop,
    });
    await master.stop();

    master.send("late steering");
    await flush();
    expect(master.turns).toBe(0);
  });

  test("records partial output that was visible before an abort", async () => {
    const observer = new RecordingObserver();
    const telemetry = new RecordingTelemetry();
    const master = new PartialOutputMaster(
      "openai/gpt-5",
      controller,
      observer,
      { onFatalError: noop, requestShutdown: noop, telemetry },
    );

    master.send("status?");
    await flush();
    expect(observer.text).toEqual(["visible partial output"]);
    await master.stop();

    const failed = telemetry.events.find(
      (event) => event.kind === "master.turn.failed",
    );
    expect(failed?.payload).toEqual({
      aborted: true,
      response: "visible partial output",
    });
  });

  for (const failedKind of [
    "master.turn.started",
    "master.text",
    "master.turn.completed",
  ] as const) {
    test(`routes ${failedKind} capture failure into coordinated shutdown`, async () => {
      const observer = new RecordingObserver();
      const telemetry = new KindFailingTelemetry(failedKind);
      const fatal = Promise.withResolvers<Error>();
      const master = new CompletedMaster("openai/gpt-5", controller, observer, {
        onFatalError: fatal.resolve,
        requestShutdown: noop,
        telemetry,
      });

      master.send("status?");
      const failure = await fatal.promise;
      expect(failure.name).toBe("TelemetryCaptureError");
      expect(failure.message).toContain(`Failed to capture ${failedKind}`);
      expect(
        telemetry.events.some((event) => event.kind === "master.turn.failed"),
      ).toBe(false);
      expect(observer.changes).toEqual([]);
      await master.stop();
    });
  }
});
