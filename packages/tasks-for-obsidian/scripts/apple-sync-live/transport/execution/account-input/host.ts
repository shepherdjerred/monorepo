import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { lstat, mkdir, open, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertUnchangedBuild } from "../../../ledger";
import {
  clientState,
  digest,
  runDirectory,
  type Manifest,
} from "../../../model";
import { guestReadFiles, requestGuest } from "../../client";
import type { FileBlob } from "../../fields";
import type { ExecutionOperation } from "../contract";
import {
  MacInputPreparedSchema,
  MacInputCollectedSchema,
  MacInputInstalledSchema,
  macInputFrame,
  assertMacInputCorrelation,
  type MacInputPrepared,
} from "./protocol";
import { driveMacInput, startMacPrivateIO } from "./session";
import {
  createMacInputApproval,
  requireMacInputApproval,
  retainMacInputPhase,
  macInputProofRoot,
} from "./proof";

type GuestManifest = Extract<Manifest, { schemaVersion: 3 }>;
type Action = Extract<ExecutionOperation, { kind: "account" }>["action"];
type LifecycleOptions = {
  lifecycleRound?: number;
  lifecycleCheckpoint?: FileBlob;
};
async function accountRequest(
  manifest: GuestManifest,
  action: Action,
  lifecycle: LifecycleOptions = {},
) {
  const result = await requestGuest(manifest, {
    kind: "account",
    action,
    ...lifecycle,
  });
  assert.equal(result.kind, "account");
  return result.receipt;
}
function validatePrepared(manifest: GuestManifest, prepared: MacInputPrepared) {
  const state = clientState(manifest, "macos");
  assert.equal(
    prepared.program,
    path.join(
      runDirectory(manifest.runID),
      "account-input/native/mac-account-private",
    ),
  );
  assert.equal(prepared.input.runID, manifest.runID);
  assert.equal(prepared.input.remoteID, manifest.allowedRemoteVaultID);
  assert.equal(
    prepared.input.guestConfigSHA256,
    manifest.execution.guestConfigSHA256,
  );
  assert.equal(prepared.input.runDirectory, runDirectory(manifest.runID));
  assert.equal(prepared.input.stateDirectory, state.stateDirectory);
  assert.equal(prepared.input.container, state.container);
  assert.equal(
    prepared.input.executable,
    path.join(
      runDirectory(manifest.runID),
      "macos/Build/Products/Debug/FacetAcceptance.app/Contents/MacOS/FacetAcceptance",
    ),
  );
  assert.equal(
    prepared.evidenceDirectory,
    path.join(
      runDirectory(manifest.runID),
      "account-input/sessions",
      prepared.input.sessionID,
    ),
  );
}

/** Exactly the two synthetic native phases; neither reads an account credential. */
export async function runMacInputProbe(
  manifest: GuestManifest,
  fresh: () => Promise<void>,
): Promise<void> {
  await fresh();
  const root = macInputProofRoot(manifest);
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const operation of [
    "credentials-probe",
    "verification-probe",
  ] as const) {
    const sessionID = crypto.randomUUID();
    const prepared = MacInputPreparedSchema.parse(
      await accountRequest(manifest, {
        mode: "input_prepare",
        operation,
        sessionID,
      }),
    );
    assertMacInputCorrelation(prepared, operation, sessionID);
    validatePrepared(manifest, prepared);
    assert.equal(prepared.probe, true);
    const email = "facet-probe-" + crypto.randomUUID() + "@example.invalid";
    const password = "Facet-private-probe-" + crypto.randomUUID() + "-q7!";
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const nativeStartedAt = Date.now();
    const io = startMacPrivateIO(manifest.execution.vm, prepared.program, true);
    let nativePassed = false,
      cleanupPassed = true;
    try {
      await driveMacInput(prepared, io, {
        fresh,
        action: () => Promise.resolve({ email, password, code }),
        recordIntent: () =>
          Promise.reject(
            new Error("Synthetic Mac probe cannot create a real Host intent"),
          ),
      });
      nativePassed = true;
    } catch {
      /* Preserve raw synthetic streams independently of native or cleanup failure. */
    } finally {
      if (!nativePassed) {
        try {
          await io.abort();
        } catch {
          cleanupPassed = false;
        }
      }
    }
    const nativeFinishedAt = Date.now();
    let guestFiles: Record<string, Uint8Array> = {},
      guestCollectionPassed = false;
    try {
      const collected = MacInputCollectedSchema.parse(
        await accountRequest(manifest, { mode: "input_collect", sessionID }),
      );
      assert.equal(collected.sessionID, sessionID);
      assert.equal(collected.evidenceDirectory, prepared.evidenceDirectory);
      const prefix = "account-input/sessions/" + sessionID + "/";
      assert.equal(new Set(collected.files).size, collected.files.length);
      assert.ok(
        collected.files.every(
          (file) =>
            file.startsWith(prefix) && !file.slice(prefix.length).includes("/"),
        ),
      );
      guestFiles = await guestReadFiles(manifest, "evidence", collected.files);
      assert.deepEqual(
        Object.keys(guestFiles).sort(),
        [...collected.files].sort(),
      );
      guestCollectionPassed = collected.passed;
    } catch {
      await writeFile(
        path.join(root, "collection-failure-" + sessionID + ".json"),
        JSON.stringify({
          schemaVersion: 1,
          sessionID,
          operation,
          classification: "owned-output-collection-incomplete",
        }),
        { flag: "wx", mode: 0o600 },
      );
    }
    await retainMacInputPhase({
      manifest,
      prepared,
      capture: io.capture(),
      guestFiles,
      guestCollectionPassed,
      nativePassed: nativePassed && cleanupPassed,
      sentinels: [email, password],
      nativeWindow: {
        startedAtUnixMilliseconds: nativeStartedAt,
        finishedAtUnixMilliseconds: nativeFinishedAt,
      },
      ...(operation === "verification-probe" ? { verificationCode: code } : {}),
    });
  }
  await assertUnchangedBuild(manifest);
  const approval = await createMacInputApproval(manifest);
  const installed = MacInputInstalledSchema.parse(
    await accountRequest(manifest, { mode: "input_approve", approval }),
  );
  assert.equal(installed.approvalSHA256, digest(JSON.stringify(approval)));
  await fresh();
}

function hostIntentPath(manifest: GuestManifest, prepared: MacInputPrepared) {
  const { input } = prepared;
  const suffix =
    input.lifecycle === null
      ? ""
      : "-" + String(input.lifecycle.round) + "-" + input.lifecycle.profileID;
  return path.join(
    macInputProofRoot(manifest),
    "intents",
    input.operation + suffix + ".json",
  );
}
async function assertNoHostIntent(
  manifest: GuestManifest,
  prepared: MacInputPrepared,
) {
  const file = hostIntentPath(manifest, prepared),
    directory = path.dirname(file);
  try {
    const stat = await lstat(directory);
    assert.ok(
      stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        stat.uid === process.getuid?.(),
    );
    assert.equal(stat.mode & 0o777, 0o700);
    assert.equal(await realpath(directory), directory);
    await lstat(file);
    throw new Error(
      "Inspect retained Mac submission intent before another credential read",
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
}
async function hostIntent(manifest: GuestManifest, prepared: MacInputPrepared) {
  const input = prepared.input,
    phase = input.operation === "vault" ? "vaults" : input.operation;
  const value = macInputFrame("intent", {
    schemaVersion: 1,
    runID: input.runID,
    sessionID: input.sessionID,
    operation: input.operation,
    phase,
    pid: input.pid,
    startSeconds: input.startSeconds,
    startMicroseconds: input.startMicroseconds,
    launchDate: input.launchDate,
    requestID: input.requestID,
    remoteID: input.remoteID,
    helperSHA256: input.helperSHA256,
    protocolSHA256: input.protocolSHA256,
  });
  const filePath = hostIntentPath(manifest, prepared),
    directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = await open(filePath, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
  const parent = await open(directory, "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}

/** Real values are supplied only after native READY and revalidated pair/source gates. */
export async function runMacPrivateAction(
  options: LifecycleOptions & {
    manifest: GuestManifest;
    operation: "credentials" | "verification" | "vault";
    fresh: () => Promise<void>;
    action: (context: {
      fresh: () => Promise<void>;
      live: () => void;
    }) => Promise<Record<string, unknown>>;
    markSubmitting: () => void;
  },
) {
  const { manifest } = options;
  const intentContext: { prepared?: MacInputPrepared } = {};
  const fresh = async () => {
    await options.fresh();
    await requireMacInputApproval(manifest);
    if (intentContext.prepared !== undefined)
      await assertNoHostIntent(manifest, intentContext.prepared);
  };
  await fresh();
  const sessionID = crypto.randomUUID();
  const prepared = MacInputPreparedSchema.parse(
    await accountRequest(
      manifest,
      { mode: "input_prepare", operation: options.operation, sessionID },
      {
        ...(options.lifecycleRound === undefined
          ? {}
          : { lifecycleRound: options.lifecycleRound }),
        ...(options.lifecycleCheckpoint === undefined
          ? {}
          : { lifecycleCheckpoint: options.lifecycleCheckpoint }),
      },
    ),
  );
  assertMacInputCorrelation(prepared, options.operation, sessionID);
  validatePrepared(manifest, prepared);
  assert.equal(prepared.probe, false);
  const approval = await requireMacInputApproval(manifest);
  assert.equal(prepared.input.approvalSHA256, digest(JSON.stringify(approval)));
  for (const key of ["helperSHA256", "protocolSHA256", "timingSHA256"] as const)
    assert.equal(prepared.input[key], approval[key]);
  intentContext.prepared = prepared;
  await assertNoHostIntent(manifest, prepared);
  const io = startMacPrivateIO(manifest.execution.vm, prepared.program, false);
  try {
    const result = await driveMacInput(prepared, io, {
      fresh,
      action: () => {
        io.assertLive();
        return options.action({ fresh, live: io.assertLive });
      },
      recordIntent: async () => {
        io.assertLive();
        await hostIntent(manifest, prepared);
        options.markSubmitting();
      },
    });
    return result;
  } catch (error) {
    try {
      await io.abort();
    } catch {
      /* Preserve the primary private-operation failure. */
    }
    throw error;
  }
}
