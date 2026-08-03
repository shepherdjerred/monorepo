import type { WorkerResult } from "./schemas.ts";

type WorkerObservationOptions = {
  prNumber: number;
  promise: Promise<WorkerResult>;
  handleFailure: (error: unknown) => void;
  handleResult: (result: WorkerResult) => void;
  reportFatal: (error: unknown) => void;
  onSettled: () => void;
};

async function observeWorker(options: WorkerObservationOptions): Promise<void> {
  let result: WorkerResult;
  try {
    result = await options.promise;
  } catch (error) {
    try {
      options.handleFailure(error);
    } catch (captureError) {
      options.reportFatal(captureError);
      throw captureError;
    } finally {
      options.onSettled();
    }
    return;
  }
  try {
    if (result.pr !== options.prNumber) {
      options.handleFailure(
        new Error(
          `worker returned a result for PR #${String(result.pr)} instead of #${String(options.prNumber)}`,
        ),
      );
      return;
    }
    options.handleResult(result);
  } catch (error) {
    options.reportFatal(error);
    throw error;
  } finally {
    options.onSettled();
  }
}

async function observeSettlementRejection(
  settlement: Promise<void>,
  reportFatal: (error: unknown) => void,
): Promise<void> {
  try {
    await settlement;
  } catch (error) {
    reportFatal(error);
  }
}

export function startWorkerObservation(
  options: WorkerObservationOptions,
): Promise<void> {
  const settlement = observeWorker(options);
  // The coordinator retains the rejecting promise for shutdown. Observe it
  // immediately too, so a fast rejection is never reported as unhandled.
  void observeSettlementRejection(settlement, options.reportFatal);
  return settlement;
}
