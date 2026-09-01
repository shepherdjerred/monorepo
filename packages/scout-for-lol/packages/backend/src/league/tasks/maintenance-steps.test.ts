import { describe, expect, test } from "vitest";
import {
  runMaintenanceSteps,
  type MaintenanceStep,
} from "#src/league/tasks/maintenance-steps.ts";

/**
 * The isolation these tests pin is a money invariant, not a tidiness one: the
 * dare refund sweeps are the LAST step of both polling tasks, so a
 * persistently throwing earlier step must never be able to starve them.
 */
function recordingStep(
  name: string,
  ran: string[],
  behavior?: () => never,
): MaintenanceStep {
  return {
    name,
    run: async () => {
      ran.push(name);
      await Promise.resolve();
      behavior?.();
    },
  };
}

describe("runMaintenanceSteps", () => {
  test("runs a later dare sweep even though an earlier step threw", async () => {
    const ran: string[] = [];
    const boom = new Error("riot api is down");
    await expect(
      runMaintenanceSteps("pre-match check", [
        recordingStep("active-game detection", ran, () => {
          throw boom;
        }),
        recordingStep("dare accept-window expiry", ran),
      ]),
    ).rejects.toBe(boom);
    expect(ran).toEqual(["active-game detection", "dare accept-window expiry"]);
  });

  test("runs every remaining step when several fail and aggregates them", async () => {
    const ran: string[] = [];
    const first = new Error("first");
    const second = new Error("second");
    let thrown: unknown;
    try {
      await runMaintenanceSteps("post-match maintenance", [
        recordingStep("pending earnings retry", ran, () => {
          throw first;
        }),
        recordingStep("stale betting pool void", ran, () => {
          throw second;
        }),
        recordingStep("dare window settle", ran),
        recordingStep("dare summary delivery", ran),
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(ran).toEqual([
      "pending earnings retry",
      "stale betting pool void",
      "dare window settle",
      "dare summary delivery",
    ]);
    expect(thrown).toBeInstanceOf(AggregateError);
    if (!(thrown instanceof AggregateError)) {
      throw new Error("expected an AggregateError");
    }
    expect(thrown.errors).toEqual([first, second]);
    expect(thrown.message).toBe("2 post-match maintenance steps failed");
  });

  test("resolves and preserves order when nothing fails", async () => {
    const ran: string[] = [];
    await runMaintenanceSteps("pre-match check", [
      recordingStep("a", ran),
      recordingStep("b", ran),
      recordingStep("c", ran),
    ]);
    expect(ran).toEqual(["a", "b", "c"]);
  });

  test("still fails the task so the Temporal activity retries", async () => {
    const boom = new Error("only failure");
    // A single failure re-throws as-is rather than being wrapped, so the
    // caller's `instanceof` checks keep working.
    await expect(
      runMaintenanceSteps("pre-match check", [
        { name: "dare summary delivery", run: () => Promise.reject(boom) },
      ]),
    ).rejects.toBe(boom);
  });
});
