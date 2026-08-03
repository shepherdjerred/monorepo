import { expect, test } from "bun:test";
import { startWorkerObservation } from "@shepherdjerred/pr-fleet-controller/src/controller-worker-observer.ts";
import { TelemetryCaptureError } from "@shepherdjerred/pr-fleet-controller/src/controller-telemetry.ts";

test("worker capture failures bypass operational failure settlement", async () => {
  const captureError = new TelemetryCaptureError(
    "worker.attempt.started",
    new Error("state volume is full"),
  );
  let failureSettlements = 0;
  let fatalReports = 0;
  let settlements = 0;
  const observation = startWorkerObservation({
    prNumber: 42,
    promise: Promise.reject(captureError),
    handleFailure: () => {
      failureSettlements += 1;
    },
    handleResult: () => {
      throw new Error("worker unexpectedly returned a result");
    },
    reportFatal: (error) => {
      expect(error).toBe(captureError);
      fatalReports += 1;
    },
    onSettled: () => {
      settlements += 1;
    },
  });

  await expect(observation).rejects.toBe(captureError);
  await Promise.resolve();
  expect(failureSettlements).toBe(0);
  expect(fatalReports).toBe(1);
  expect(settlements).toBe(1);
});
