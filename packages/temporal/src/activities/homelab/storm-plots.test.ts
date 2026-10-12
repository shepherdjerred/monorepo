import { describe, expect, test, vi } from "vitest";
import type { Command, CommandResult } from "./mining-reset-kubectl.ts";
import {
  plotReconcileState,
  reconcileStormPlotsWithDependencies,
} from "./storm-plots.ts";

const operation = "11111111-1111-4111-8111-111111111111";
const result = (stdout: string): CommandResult => ({
  stdout,
  stderr: "",
  exitCode: 0,
});

function fixture(states: readonly string[], ready = true) {
  const calls: string[][] = [];
  let index = 0;
  const command: Command = async (args) => {
    calls.push([...args]);
    if (args.includes("get")) {
      return result(
        JSON.stringify({
          metadata: {},
          spec: { replicas: ready ? 1 : 0 },
          status: { readyReplicas: ready ? 1 : 0 },
        }),
      );
    }
    const state = states[index++];
    if (state === undefined) throw new Error("Unexpected extra RCON call");
    return result(`PLOT_RECONCILE ${operation} ${state}`);
  };
  return {
    calls,
    command,
    heartbeat: vi.fn(),
    sleep: vi.fn(() => Promise.resolve()),
  };
}

describe("The Storm plot reconciliation", () => {
  test("sleeping servers are skipped without exec or wake", async () => {
    const dependencies = fixture([], false);
    expect(
      await reconcileStormPlotsWithDependencies(operation, dependencies),
    ).toBe("sleeping");
    expect(dependencies.calls).toHaveLength(1);
    expect(dependencies.calls[0]).toContain("statefulset");
  });

  test("polls the same operation and resumes after a server restart", async () => {
    const dependencies = fixture(["RUNNING", "UNKNOWN", "RUNNING", "COMPLETE"]);
    expect(
      await reconcileStormPlotsWithDependencies(operation, dependencies),
    ).toBe("completed");
    expect(dependencies.calls.map((call) => call.at(-1))).toEqual([
      "json",
      `plot admin reconcile ${operation}`,
      `plot admin status ${operation}`,
      `plot admin reconcile ${operation}`,
      `plot admin status ${operation}`,
    ]);
  });

  test("busy is a deferral while failed journals are visible failures", async () => {
    expect(
      await reconcileStormPlotsWithDependencies(operation, fixture(["BUSY"])),
    ).toBe("busy");
    await expect(
      reconcileStormPlotsWithDependencies(operation, fixture(["FAILED"])),
    ).rejects.toThrow("retains its protected journals");
  });

  test("rejects foreign operations, unknown statuses and command injection", async () => {
    expect(() =>
      plotReconcileState(
        `PLOT_RECONCILE 22222222-2222-4222-8222-222222222222 COMPLETE`,
        operation,
      ),
    ).toThrow("mismatched");
    expect(() =>
      plotReconcileState(`PLOT_RECONCILE ${operation} READY`, operation),
    ).toThrow();
    const dependencies = fixture([]);
    await expect(
      reconcileStormPlotsWithDependencies("invalid; stop", dependencies),
    ).rejects.toThrow();
    expect(dependencies.calls).toHaveLength(0);
  });
});
