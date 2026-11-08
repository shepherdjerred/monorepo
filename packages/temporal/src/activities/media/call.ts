import { ApplicationFailure, Context } from "@temporalio/activity";
import { CancelledFailure } from "@temporalio/common";

/** Keep generic Media failures free of provider URLs, queries and credentials. */
export async function mediaCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    assertMediaActive();
    const result = await work();
    assertMediaActive();
    return result;
  } catch (error) {
    if (error instanceof CancelledFailure) throw error;
    throw ApplicationFailure.create({
      message: "Media Activity failed; inspect sanitized operation status",
      type: "MediaActivityFailure",
    });
  }
}

function assertMediaActive() {
  if (Context.current().cancellationSignal.aborted)
    throw new CancelledFailure("Media Activity cancelled");
}
