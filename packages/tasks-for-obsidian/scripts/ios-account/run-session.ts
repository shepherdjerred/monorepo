import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  assertUnchangedBuild,
  acceptanceProvenance,
} from "../apple-sync-live/ledger";
import { runDirectory, type Manifest } from "../apple-sync-live/model";
import { runSelectedIosJourneyTest } from "../native-acceptance/selected-tests";
import { withPrivateAccountInput, type AccountInputClient } from "./connection";
import { PrivateAppInput } from "./app-input";
import type { AccountOperation } from "./contract";
import { prepareInputArtifacts } from "./app-input-artifacts";
import { recordHostIntent } from "./phases/intents";
import { finalizePrivatePhase } from "./phases/result";
import { PrivatePhaseFailure } from "./phases/failure";
import {
  prepareAccountInvocation,
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
    options.operation === "auth-only" || options.operation === "connect-only"
      ? "entries"
      : "probes",
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
  let mountedDirectory: string | undefined;
  let inputFailure: ReturnType<PrivateAppInput["failure"]> | undefined;
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
    try {
      const directory = await waitForPrivateSocket(
        invocation.device,
        invocation.identity.sessionID,
        () => nativeEnded,
      );
      mountedDirectory = directory;
      const hash = invocation.runnerFiles["TasksForObsidianUITests-Runner"];
      assert.ok(
        hash !== undefined,
        "Private input runner lacks its expected executable fingerprint",
      );
      return await withPrivateAccountInput(
        {
          directory,
          identity: invocation.identity,
          operation: options.operation,
          recordIntent: async (intent) => {
            try {
              await recordHostIntent(evidence, intent);
            } catch {
              throw new PrivatePhaseFailure(
                "intent",
                intent.action === "connect"
                  ? "connect"
                  : intent.action === "verification"
                    ? "verification"
                    : "credentials",
              );
            }
          },
          validateOwner: runnerOwnerValidator(invocation.device, hash, {
            runID: manifest.runID,
            artifacts: appInputFiles,
            files: invocation.runnerFiles,
          }),
          app: await appInput.bind(),
        },
        options.action,
      );
    } catch (error) {
      inputFailure = appInput.failure(error);
      throw error;
    }
  })();
  const outcomes = await Promise.allSettled([native, input]);
  const finalized = await finalizePrivatePhase({
    manifest,
    operation: options.operation,
    evidence,
    result,
    command,
    appInput,
    identity: invocation.identity,
    mountedDirectory,
    outcomes,
    inputFailure,
    inspectEvidence: options.inspectEvidence,
  });
  return {
    evidence,
    appFiles: z
      .record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u))
      .parse(provenance.iosApp),
    probeID,
    runnerFiles: invocation.runnerFiles,
    sourceFiles: provenance.sourceFiles,
    sourceHead: provenance.sourceHead,
    receipt: finalized.receipt,
    retainedLogs: finalized.retainedLogs,
    appInputFiles,
    sessionID,
    nativeIntents: finalized.nativeIntents,
  };
}
