import {
  ActivityFailure,
  ApplicationFailure,
  proxyActivities,
  sleep,
  upsertMemo,
  uuid4,
} from "@temporalio/workflow";
import type { CiExtendedVerifyActivities } from "#activities/maintenance/ci-extended-verify.ts";
import {
  extendedVerifyFailureMessage,
  extendedVerifySucceeded,
  isTerminalPipelineStatus,
  supersededReceipt,
  type CiExtendedVerifyMemo,
  type CiExtendedVerifyResult,
  type CiExtendedVerifySkipReason,
  type ExtendedVerifyReceipt,
  type ExtendedVerifyRequest,
  type ExtendedVerifySubmission,
} from "#shared/ci-extended-verify.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const reads = proxyActivities<CiExtendedVerifyActivities>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3, initialInterval: "10 seconds" },
});
// Polling outlives a Woodpecker restart: a transient API outage during a
// 45-minute run must not become a false nightly failure.
const polls = proxyActivities<CiExtendedVerifyActivities>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "1 minute",
  retry: {
    maximumAttempts: 5,
    initialInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumInterval: "5 minutes",
  },
});
const writes = proxyActivities<CiExtendedVerifyActivities>({
  taskQueue: TASK_QUEUES.REPO_AUTOMATION,
  startToCloseTimeout: "1 minute",
  // A lost POST response never authorizes another submission.
  retry: { maximumAttempts: 1 },
});

/** A canary rarely runs longer than an hour; after that the night is skipped. */
const DEFERRAL_LIMIT = 6;
const DEFERRAL_DELAY = "10 minutes";
const POLL_INTERVAL = "2 minutes";
const READ_BACK_DELAY = "1 minute";

/** The activity's own message, not the SDK's `Activity task failed` wrapper. */
function failureReason(error: unknown): string {
  if (error instanceof ActivityFailure && error.cause instanceof Error)
    return error.cause.message;
  return error instanceof Error ? error.message : String(error);
}

/** Submits once; an ambiguous write is reconciled by request ID, never repeated. */
async function submit(
  request: ExtendedVerifyRequest,
  record: (observation: string) => void,
): Promise<ExtendedVerifySubmission> {
  try {
    return await writes.submitExtendedVerify(request);
  } catch (error) {
    record(
      `Submission outcome uncertain (${failureReason(error)}); reading back by request ID`,
    );
    await sleep(READ_BACK_DELAY);
    const receipt = await reads.findExtendedVerifyReceipt(request.requestId);
    if (receipt !== null) return { kind: "submitted", receipt };
    const message = `Extended verify submission ${request.requestId} failed and left no pipeline receipt: ${failureReason(error)}`;
    record(message);
    throw ApplicationFailure.nonRetryable(message);
  }
}

/**
 * Nightly extended test tier on the newest verified main.
 *
 * One manual Woodpecker pipeline carries `CI_EXTENDED_REQUEST` and
 * `CI_EXTENDED_SOURCE`; the config extension emits its `verify-extended`
 * workflow. The Workflow polls with durable timers and fails on a red
 * pipeline so `temporal-failure-watch` turns it into the usual Alertmanager
 * occurrence; there is no bespoke alert path. A disabled flag, a missing
 * verified source, an hour of deferral behind a canary, or a superseded source
 * ends the run as skipped, never failed.
 */
export async function runCiExtendedVerifyWorkflow(): Promise<CiExtendedVerifyResult> {
  const startedAt = Date.now();
  // Recorded before any write; replay never invents another ID.
  const requestId = uuid4();
  const memo: CiExtendedVerifyMemo = {
    requestId,
    source: null,
    pipeline: null,
    url: null,
    status: null,
    observation: "selecting the verified main source",
  };
  const record = (observation: string) => {
    memo.observation = observation;
    upsertMemo({ ciExtendedVerify: memo });
  };
  const skip = (
    reason: CiExtendedVerifySkipReason,
    detail: string,
  ): CiExtendedVerifyResult => {
    record(`Skipped (${reason}): ${detail}`);
    return { outcome: "skipped", reason, detail };
  };

  let receipt: ExtendedVerifyReceipt | null = null;
  for (let deferrals = 0; receipt === null; deferrals++) {
    // Nothing has been written yet, so a source that moved while deferred is
    // simply reselected under the same request ID.
    memo.source = await reads.selectExtendedVerifySource();
    if (memo.source === null)
      return skip("no-verified-source", "no complete main build to verify");
    record(`Submitting request ${requestId} for ${memo.source}`);
    const submission = await submit({ requestId, source: memo.source }, record);
    if (submission.kind === "skipped")
      return skip("disabled", "ci-extended-verify-dispatch-enabled is off");
    if (submission.kind === "deferred") {
      if (deferrals >= DEFERRAL_LIMIT)
        return skip(
          "deferred",
          `still deferred after ${DEFERRAL_LIMIT.toString()} attempts: ${submission.reason}`,
        );
      record(`Deferred: ${submission.reason}; retrying in ${DEFERRAL_DELAY}`);
      await sleep(DEFERRAL_DELAY);
    } else {
      receipt = submission.receipt;
    }
  }

  memo.pipeline = receipt.number;
  memo.url = receipt.url;
  memo.status = receipt.status;
  record(`Pipeline ${receipt.number.toString()} is ${receipt.status}`);
  while (!isTerminalPipelineStatus(receipt.status)) {
    await sleep(POLL_INTERVAL);
    receipt = await polls.describeExtendedVerify(receipt.number);
    memo.status = receipt.status;
    record(`Pipeline ${receipt.number.toString()} is ${receipt.status}`);
  }

  if (supersededReceipt(receipt))
    return skip(
      "superseded",
      `main advanced before pipeline ${receipt.number.toString()} ran; ${receipt.url}`,
    );
  if (!extendedVerifySucceeded(receipt)) {
    const message = extendedVerifyFailureMessage(receipt);
    record(message);
    throw ApplicationFailure.nonRetryable(message);
  }
  const durationMs = Date.now() - startedAt;
  record(
    `Pipeline ${receipt.number.toString()} verified ${memo.source ?? receipt.commit} in ${Math.round(durationMs / 60_000).toString()} min`,
  );
  return {
    outcome: "verified",
    pipeline: receipt.number,
    url: receipt.url,
    commit: memo.source ?? receipt.commit,
    durationMs,
  };
}
