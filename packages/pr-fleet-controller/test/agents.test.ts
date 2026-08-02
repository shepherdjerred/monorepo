import { describe, expect, test } from "bun:test";
import { MastraMaster } from "@shepherdjerred/pr-fleet-controller/src/agents.ts";
import type { MasterControllerTools } from "@shepherdjerred/pr-fleet-controller/src/master-tools.ts";
import type { FleetObserver } from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
import type { FleetSnapshot } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";

const snapshot: FleetSnapshot = {
  open: 0,
  green: 0,
  active: 0,
  queued: 0,
  pending: 0,
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
  stop: () => Promise.resolve(snapshot),
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

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 5));

describe("master shutdown", () => {
  test("aborts and awaits the in-flight master turn before resolving", async () => {
    const observer = new RecordingObserver();
    const master = new HangingMaster("openai/gpt-5", controller, observer);

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
    const master = new HangingMaster("openai/gpt-5", controller, observer);
    await master.stop();

    master.send("late steering");
    await flush();
    expect(master.turns).toBe(0);
  });
});
