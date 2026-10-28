import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readAcceptanceResultReports } from "tasknotes-macos/scripts/acceptance-execution.ts";
import {
  assertUnchangedBuild,
  acceptanceProvenance,
} from "../apple-sync-live/ledger";
import { assertExactNativeJourney } from "../apple-sync-live/native-evidence";
import { runDirectory, type Manifest } from "../apple-sync-live/model";
import { runSelectedIosJourneyTest } from "../native-acceptance/selected-tests";
import { exportIosJourneyAttachments } from "../native-acceptance/attachments";
import { retainPrivateInputLogs } from "./retention";
import { withPrivateAccountInput, type AccountInputClient } from "./connection";
import { PrivateAppInput } from "./app-input";
import type { AccountOperation } from "./contract";
import { prepareInputArtifacts } from "./app-input-artifacts";
import {
  prepareAccountInvocation,
  privateAccountSelector,
  privateNativeCommand,
  runnerOwnerValidator,
  waitForPrivateSocket,
} from "./runtime";

type SessionAction = (
  session: AccountInputClient,
) => Promise<Record<string, unknown>>;

export async function executePrivateAccountSession(
  manifest: Manifest,
  options: {
    operation: AccountOperation;
    runnerFiles?: Record<string, string>;
    originalProfileID?: string;
    action: SessionAction;
    inspectEvidence?: (directory: string) => Promise<void>;
  },
) {
  await assertUnchangedBuild(manifest);
  const run = runDirectory(manifest.runID);
  const provenance = acceptanceProvenance(
    manifest,
    await Bun.file(path.join(run, "provenance.json")).json(),
  );
  const probeID = crypto.randomUUID();
  const evidence = path.join(
    run,
    "ios-account",
    options.operation === "credentials" ? "entries" : "probes",
    probeID,
  );
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const appInputFiles = await prepareInputArtifacts(
    manifest,
    evidence,
    options.operation === "probe" ? "probe" : "credentials",
  );
  assert.ok(manifest.simulator !== null && "iosApp" in provenance);
  const sessionID = crypto.randomUUID();
  const appInput = await PrivateAppInput.start(
    manifest,
    {
      sessionID,
      runID: manifest.runID.toLowerCase(),
      deviceID: manifest.simulator.id.toLowerCase(),
    },
    evidence,
    {
      appFiles: z
        .record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u))
        .parse(provenance.iosApp),
      operation: options.operation,
    },
  );
  let invocation: Awaited<ReturnType<typeof prepareAccountInvocation>>;
  try {
    invocation = await prepareAccountInvocation(
      manifest,
      sessionID,
      { ...appInput.bootstrap, FACET_E2E_ACCOUNT_OPERATION: options.operation },
      options.originalProfileID,
    );
    if (options.operation !== "probe") {
      assert.ok(options.runnerFiles !== undefined);
      assert.deepEqual(
        invocation.runnerFiles,
        options.runnerFiles,
        "Prepared Runner differs from the validated privacy proof",
      );
      invocation.runnerFiles = Object.freeze({ ...options.runnerFiles });
    }
    await assertUnchangedBuild(manifest);
  } catch {
    await appInput.close();
    throw new Error("Private input invocation preparation failed");
  }
  const command = privateNativeCommand(evidence);
  const result = path.join(evidence, "AccountInput.xcresult");
  let nativeEnded = false;
  const native = (async () => {
    try {
      await runSelectedIosJourneyTest(
        {
          testRun: invocation.testRun,
          device: invocation.device,
          result,
          suite: "AccountInputUITests",
          test: "testPrivateAccountInput",
        },
        command,
      );
    } finally {
      nativeEnded = true;
    }
  })();
  const input = (async () => {
    const directory = await waitForPrivateSocket(
      invocation.device,
      invocation.identity.sessionID,
      () => nativeEnded,
    );
    const hash = invocation.runnerFiles["TasksForObsidianUITests-Runner"];
    assert.ok(
      hash !== undefined,
      "Private input runner lacks its expected executable fingerprint",
    );
    return withPrivateAccountInput(
      {
        directory,
        identity: invocation.identity,
        operation: options.operation,
        validateOwner: runnerOwnerValidator(invocation.device, hash, {
          runID: manifest.runID,
          artifacts: appInputFiles,
          files: invocation.runnerFiles,
        }),
        app: await appInput.bind(),
      },
      options.action,
    );
  })();
  const outcomes = await Promise.allSettled([native, input]);
  const failures: unknown[] = [];
  try {
    await writeFile(
      path.join(evidence, "input-stages.json"),
      JSON.stringify({
        schemaVersion: 1,
        runID: manifest.runID,
        native: outcomes[0].status,
        input: outcomes[1].status,
      }),
      { flag: "wx", mode: 0o600 },
    );
  } catch {
    failures.push(new Error("Private input primary receipt is incomplete"));
  }
  const closed = await appInput.close();
  if (closed.status !== "closed")
    failures.push(new Error("Private input cleanup is incomplete"));
  let retainedLogs:
    Awaited<ReturnType<typeof retainPrivateInputLogs>> | undefined;
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") failures.push(outcome.reason);
  }
  try {
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
    retainedLogs = await retainPrivateInputLogs(result, evidence, command);
    assertExactNativeJourney(
      JSON.parse(reports.summaryJSON),
      JSON.parse(reports.testsJSON),
      "TasksForObsidianUITests",
      privateAccountSelector,
    );
    await assertUnchangedBuild(manifest);
  } catch (error) {
    failures.push(error);
  }
  try {
    await options.inspectEvidence?.(evidence);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    await writeFile(
      path.join(evidence, "outcome.json"),
      JSON.stringify({
        schemaVersion: 1,
        runID: manifest.runID,
        operation: options.operation,
        status: "failed",
        credentialsReady: false,
      }),
      { flag: "wx", mode: 0o600 },
    );
    throw new Error(
      "Private iOS input failed; inspect private synthetic evidence and do not repeat an uncertain submission",
    );
  }
  const reply = outcomes[1];
  assert.equal(reply.status, "fulfilled");
  assert.ok(retainedLogs !== undefined);
  return {
    evidence,
    appFiles: z
      .record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u))
      .parse(provenance.iosApp),
    probeID,
    runnerFiles: invocation.runnerFiles,
    sourceFiles: provenance.sourceFiles,
    sourceHead: provenance.sourceHead,
    receipt: reply.value,
    retainedLogs,
    appInputFiles,
  };
}
