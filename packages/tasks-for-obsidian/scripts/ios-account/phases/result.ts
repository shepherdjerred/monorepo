import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { readAcceptanceResultReports } from "tasknotes-macos/scripts/acceptance-execution.ts";
import { assertUnchangedBuild } from "../../apple-sync-live/ledger";
import type { Manifest } from "../../apple-sync-live/model";
import { assertExactNativeJourney } from "../../apple-sync-live/native-evidence";
import { exportIosJourneyAttachments } from "../../native-acceptance/attachments";
import { retainPrivateInputLogs } from "../retention";
import { privateAccountSelector, type privateNativeCommand } from "../runtime";
import type { PrivateAppInput } from "../app-input";
import type { AccountIdentity, AccountOperation } from "../contract";
import { retainNativeIntents } from "./intents";
import { PrivatePhaseFailure } from "./failure";

type Options = {
  manifest: Manifest;
  operation: AccountOperation;
  evidence: string;
  result: string;
  command: ReturnType<typeof privateNativeCommand>;
  appInput: PrivateAppInput;
  identity: AccountIdentity;
  mountedDirectory: string | undefined;
  outcomes: [
    PromiseSettledResult<void>,
    PromiseSettledResult<Record<string, unknown>>,
  ];
  inputFailure: ReturnType<PrivateAppInput["failure"]> | undefined;
  inspectEvidence: ((directory: string) => Promise<void>) | undefined;
};
async function settleLifecycle(options: Options) {
  const { evidence, manifest, operation, outcomes, appInput, inputFailure } =
    options;
  const failures: unknown[] = [];
  try {
    await writeFile(
      path.join(evidence, "input-stages.json"),
      JSON.stringify({
        schemaVersion: 1,
        runID: manifest.runID,
        native: outcomes[0].status,
        input: outcomes[1].status,
        operation,
        primary:
          inputFailure ??
          (outcomes[0].status === "rejected"
            ? appInput.failure(undefined, "native")
            : null),
      }),
      { flag: "wx", mode: 0o600 },
    );
  } catch {
    failures.push(new PrivatePhaseFailure("retention", "retention"));
  }
  const closed = await appInput.close();
  let nativeIntents:
    Awaited<ReturnType<typeof retainNativeIntents>> | undefined;
  try {
    nativeIntents = await retainNativeIntents(
      options.mountedDirectory,
      evidence,
      options.identity,
    );
  } catch {
    failures.push(new PrivatePhaseFailure("retention", "retention"));
  }
  if (
    nativeIntents === undefined ||
    !nativeIntents.available ||
    nativeIntents.missingNative.length > 0
  )
    failures.push(new PrivatePhaseFailure("intent", "retention"));
  if (closed.status !== "closed")
    failures.push(new PrivatePhaseFailure("cleanup", "cleanup"));
  for (const outcome of outcomes)
    if (outcome.status === "rejected") failures.push(outcome.reason);
  return { failures, closed, nativeIntents };
}
async function retainReports(options: Options) {
  const { result, evidence, command, manifest } = options;
  const reports = await readAcceptanceResultReports(
    result,
    {
      summary: path.join(evidence, "summary.json"),
      tests: path.join(evidence, "tests.json"),
    },
    command,
  );
  await exportIosJourneyAttachments(
    result,
    path.join(evidence, "attachments"),
    command,
  );
  const retained = await retainPrivateInputLogs(result, evidence, command);
  assertExactNativeJourney(
    JSON.parse(reports.summaryJSON),
    JSON.parse(reports.testsJSON),
    "TasksForObsidianUITests",
    privateAccountSelector,
  );
  await assertUnchangedBuild(manifest);
  return retained;
}
async function retainFailure(
  options: Options,
  lifecycle: Awaited<ReturnType<typeof settleLifecycle>>,
) {
  const { appInput, outcomes, evidence, manifest, operation } = options;
  const known = lifecycle.failures.find(
    (error) => error instanceof PrivatePhaseFailure,
  );
  const fallback =
    outcomes[0].status === "rejected"
      ? new PrivatePhaseFailure("native", "prepare")
      : new PrivatePhaseFailure("retention", "retention");
  try {
    await writeFile(
      path.join(evidence, "primary-failure.json"),
      JSON.stringify({
        schemaVersion: 1,
        runID: manifest.runID,
        operation,
        primary: options.inputFailure ?? appInput.failure(known ?? fallback),
        cleanup: lifecycle.closed.status,
        nativeIntents: lifecycle.nativeIntents ?? {
          available: false,
          actions: [],
        },
      }),
      { flag: "wx", mode: 0o600 },
    );
  } catch {
    // Missing metadata remains a failure; it never replaces the original rejection or skips cleanup.
  }
}
export async function finalizePrivatePhase(options: Options) {
  const lifecycle = await settleLifecycle(options),
    { failures, closed, nativeIntents } = lifecycle;
  let retainedLogs: Awaited<ReturnType<typeof retainReports>> | undefined;
  try {
    retainedLogs = await retainReports(options);
  } catch {
    failures.push(new PrivatePhaseFailure("retention", "retention"));
  }
  try {
    // Include final native/input metadata before any successful privacy inventory is measured.
    await writeFile(
      path.join(options.evidence, "outcome.json"),
      JSON.stringify({
        schemaVersion: 1,
        runID: options.manifest.runID,
        operation: options.operation,
        status: failures.length === 0 ? "passed" : "failed",
        scope: "native-input-and-cleanup",
        native: options.outcomes[0].status,
        input: options.outcomes[1].status,
        cleanup: closed.status,
        nativeIntents: nativeIntents ?? { available: false, actions: [] },
      }),
      { flag: "wx", mode: 0o600 },
    );
  } catch {
    failures.push(new PrivatePhaseFailure("retention", "retention"));
  }
  try {
    await options.inspectEvidence?.(options.evidence);
  } catch {
    failures.push(new PrivatePhaseFailure("retention", "retention"));
  }
  if (failures.length > 0) {
    await retainFailure(options, lifecycle);
    throw new Error(
      "Private iOS phase failed; preserve its intents and do not repeat an uncertain submission",
    );
  }
  const reply = options.outcomes[1];
  assert.ok(
    reply.status === "fulfilled" &&
      retainedLogs !== undefined &&
      nativeIntents !== undefined,
  );
  return { receipt: reply.value, retainedLogs, nativeIntents };
}
