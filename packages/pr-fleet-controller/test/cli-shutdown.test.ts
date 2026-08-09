import { expect, test } from "bun:test";
import { settleCliResources } from "@shepherdjerred/pr-fleet-controller/src/cli-shutdown.ts";
import { ControllerStopError } from "@shepherdjerred/pr-fleet-controller/src/controller-stop-error.ts";
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

test("CLI settlement preserves a controller failure's final snapshot", async () => {
  const failure = new Error("worker settlement capture failed");
  let observed: FleetSnapshot | undefined;
  let runtimeClosed = false;
  let inputClosed = false;
  const settlementOrder: string[] = [];

  const settlement = await settleCliResources({
    closeOperatorControl: () => {
      settlementOrder.push("operator-control");
      return Promise.resolve();
    },
    input: () => ({
      close: () => {
        settlementOrder.push("input");
        inputClosed = true;
      },
    }),
    master: () => ({ stop: () => Promise.resolve() }),
    controller: () => ({
      stop: () => {
        settlementOrder.push("controller");
        return Promise.reject(new ControllerStopError(snapshot, failure));
      },
    }),
    runtime: () =>
      Promise.resolve({
        shutdown: () => {
          runtimeClosed = true;
          return Promise.resolve();
        },
      }),
    observeSnapshot: (value) => {
      observed = value;
    },
  });

  expect(settlement.snapshot).toBe(snapshot);
  expect(settlement.failure).toBeInstanceOf(ControllerStopError);
  expect(observed).toBe(snapshot);
  expect(inputClosed).toBe(true);
  expect(runtimeClosed).toBe(true);
  expect(settlementOrder.indexOf("operator-control")).toBeLessThan(
    settlementOrder.indexOf("controller"),
  );
});
