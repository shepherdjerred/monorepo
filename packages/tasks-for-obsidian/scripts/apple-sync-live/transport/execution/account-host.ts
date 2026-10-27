import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { requestGuest } from "../client.ts";
import { encodeBlob } from "../fields.ts";
import { readManifest, save } from "../../platform.ts";
import { assertUnchangedBuild } from "../../ledger.ts";
import { digest, runDirectory, type Manifest } from "../../model.ts";
import {
  checkpointPath,
  lifecycleCheckpoint,
  assertLifecycleEvidence,
  verifyLifecycleReplica,
} from "tasknotes-macos/scripts/mac-account-lifecycle.ts";
import {
  assertFreshInitialStatus,
  type Operation,
  credentialBackend,
} from "tasknotes-macos/scripts/mac-account-contract.ts";
import type {
  ClosedAccountReceiptSchema,
  ExecutionOperation,
} from "./contract.ts";
import {
  readHostCredentialItem,
  readHostVaultPassword,
  readHostVerificationCode,
  PasswordManagerFailure,
} from "./credential-host.ts";

type GuestAccount = Extract<ExecutionOperation, { kind: "account" }>;
const LifetimeSchema = z.strictObject({
  startSeconds: z.number().int().nonnegative(),
  startMicroseconds: z.number().int().nonnegative(),
  launchDate: z.number().positive(),
});
/** Host-only 1Password broker. The guest never receives a vault session or secret locator. */
export async function runHostGuestAccount(options: {
  manifest: Extract<Manifest, { schemaVersion: 3 }>;
  operation: Operation;
  parameters: Record<string, string>;
  lifecycleRound?: number;
}): Promise<number> {
  const { manifest, operation, parameters, lifecycleRound } = options;
  const submission = { possible: false };
  try {
    assert.ok(manifest.allowedRemoteVaultID !== null);
    const directory = runDirectory(manifest.runID);
    const checkpoint =
      lifecycleRound === undefined
        ? null
        : lifecycleCheckpoint(
            manifest,
            JSON.parse(await readFile(checkpointPath(directory), "utf8")),
            lifecycleRound,
          );
    const checkpointBytes =
      checkpoint === null
        ? undefined
        : await readFile(checkpointPath(directory));
    const checkpointSHA =
      checkpointBytes === undefined ? undefined : digest(checkpointBytes);
    const status = async () => {
      const result = await requestGuest(manifest, { kind: "status" });
      if (result.kind !== "status")
        throw new Error("Wrong private account status reply");
      return result.status;
    };
    const validateState = (reauthorized = false) =>
      validateAccountState(
        {
          manifest,
          directory,
          checkpoint,
          checkpointSHA,
          lifecycleRound,
          status,
        },
        reauthorized,
      );
    async function native(action: GuestAccount["action"]) {
      await validateState();
      const response = await requestGuest(manifest, {
        kind: "account",
        action,
        ...(lifecycleRound === undefined ? {} : { lifecycleRound }),
        ...(checkpointBytes === undefined
          ? {}
          : { lifecycleCheckpoint: encodeBlob(checkpointBytes) }),
      });
      if (response.kind !== "account")
        throw new Error("Wrong private native account receipt");
      console.log(JSON.stringify(response.receipt));
      return response.receipt;
    }
    const inspecting =
      operation === "present"
        ? checkpoint === null
          ? "inspect_onboarding"
          : "inspect_workspace"
        : `inspect_${operation}`;
    const action = GuestAccountActionInspectSchema.parse({ mode: inspecting });
    const inspected = await native(action);
    assert.equal(inspected.ready, true);
    const lifetime = LifetimeSchema.parse({
      startSeconds: inspected.startSeconds,
      startMicroseconds: inspected.startMicroseconds,
      launchDate: inspected.launchDate,
    });
    if (operation === "present") {
      await native({
        mode:
          checkpoint === null ? "present_account" : "present_lifecycle_account",
        lifetime,
      });
      return 0;
    }
    await submitAccountInput({
      operation,
      parameters,
      lifetime,
      inspected,
      native,
      validateState,
      status,
      checkpoint,
      manifest,
      markSubmitting: () => {
        submission.possible = true;
      },
    });
    return 0;
  } catch (error) {
    const classified =
      error instanceof PasswordManagerFailure
        ? error.classification
        : "guest_account_guard";
    console.log(
      JSON.stringify({
        blocked: classified,
        submissionStatus: submission.possible ? "unknown" : "not_attempted",
      }),
    );
    return 3;
  }
}
function readAccountSecret(
  operation: Exclude<Operation, "present">,
  parameters: Record<string, string>,
):
  | { kind: "credentials"; value: { email: string; password: string } }
  | { kind: "text"; value: string } {
  if (operation === "vault")
    return {
      kind: "text",
      value: readHostVaultPassword(
        parameters["--vault-password-ref"] ?? "",
        credentialBackend(parameters["--vault-password-backend"]),
      ),
    };
  const selected = {
    "--account": parameters["--account"] ?? "",
    "--vault": parameters["--vault"] ?? "",
    "--item": parameters["--item"] ?? "",
  };
  return operation === "credentials"
    ? {
        kind: "credentials",
        value: readHostCredentialItem(
          selected,
          credentialBackend(parameters["--credential-backend"]),
        ),
      }
    : {
        kind: "text",
        value: readHostVerificationCode(
          selected,
          credentialBackend(parameters["--credential-backend"]),
        ),
      };
}
async function waitReauthorization(
  status: () => Promise<unknown>,
  profileID: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  const schema = z.object({
    accountBusy: z.boolean(),
    profiles: z
      .array(z.object({ profileID: z.literal(profileID), phase: z.string() }))
      .length(1),
  });
  for (;;) {
    const parsed = schema.parse(await status());
    const profile = parsed.profiles[0];
    assert.ok(profile);
    if (
      !parsed.accountBusy &&
      !["reconnectRequired", "connecting"].includes(profile.phase)
    )
      return;
    assert.ok(
      Date.now() < deadline,
      "Lifecycle reauthorization exceeded its deadline",
    );
    await Bun.sleep(250);
  }
}
const GuestAccountActionInspectSchema = z.strictObject({
  mode: z.enum([
    "inspect_onboarding",
    "inspect_credentials",
    "inspect_verification",
    "inspect_vault",
    "inspect_workspace",
  ]),
});

async function validateAccountState(
  context: {
    manifest: Extract<Manifest, { schemaVersion: 3 }>;
    directory: string;
    checkpoint: ReturnType<typeof lifecycleCheckpoint> | null;
    checkpointSHA: string | undefined;
    lifecycleRound: number | undefined;
    status: () => Promise<unknown>;
  },
  reauthorized: boolean,
) {
  const {
    manifest,
    directory,
    checkpoint,
    checkpointSHA,
    lifecycleRound,
    status,
  } = context;
  const current = await readManifest(manifest.runID);
  assert.equal(current.schemaVersion, 3);
  assert.deepEqual(current.execution, manifest.execution);
  assert.equal(current.allowedRemoteVaultID, manifest.allowedRemoteVaultID);
  assert.equal(current.runID, manifest.runID);
  assert.equal(current.round, manifest.round);
  assert.equal(current.failures.length, 0);
  assert.equal(current.cases["official-reference"], "pass");
  assert.equal(
    current.stage,
    lifecycleRound === undefined ? "bound" : "initial-verified",
  );
  await assertUnchangedBuild(current);
  await save(current);
  const value = await status();
  if (checkpoint === null) assertFreshInitialStatus(value, manifest.runID);
  else {
    assert.deepEqual(
      lifecycleCheckpoint(
        current,
        JSON.parse(await readFile(checkpointPath(directory), "utf8")),
        checkpoint.round,
      ),
      checkpoint,
    );
    assert.equal(
      digest(await readFile(checkpointPath(directory))),
      checkpointSHA,
    );
    const outbox = await verifyLifecycleReplica(current, checkpoint);
    const interruption = await requestGuest(current, {
      kind: "interruption",
    });
    if (interruption.kind !== "interruption")
      throw new Error("Wrong private interruption reply");
    assertLifecycleEvidence(
      current,
      checkpoint,
      value,
      outbox,
      interruption.interruption,
      reauthorized,
    );
  }
}

type NativeAccountReceipt = z.infer<typeof ClosedAccountReceiptSchema>;
async function submitAccountInput(context: {
  operation: Exclude<Operation, "present">;
  parameters: Record<string, string>;
  lifetime: z.infer<typeof LifetimeSchema>;
  inspected: NativeAccountReceipt;
  native: (action: GuestAccount["action"]) => Promise<NativeAccountReceipt>;
  validateState: (reauthorized?: boolean) => Promise<void>;
  status: () => Promise<unknown>;
  checkpoint: ReturnType<typeof lifecycleCheckpoint> | null;
  manifest: Extract<Manifest, { schemaVersion: 3 }>;
  markSubmitting: () => void;
}) {
  const {
    operation,
    parameters,
    lifetime,
    inspected,
    native,
    validateState,
    status,
    checkpoint,
    manifest,
    markSubmitting,
  } = context;
  const activate = () =>
    native({
      mode:
        operation === "credentials"
          ? "activate_credentials"
          : operation === "verification"
            ? "activate_verification"
            : "activate_vault",
      lifetime,
    });
  await activate();
  await validateState();
  console.log(
    JSON.stringify({
      phase: "password_manager_read",
      operation,
      submissionStatus: "not_attempted",
    }),
  );
  const secret = readAccountSecret(operation, parameters);
  await validateState();
  await activate();
  if (operation === "credentials") {
    assert.equal(secret.kind, "credentials");
    const filled = await native({
      mode: "fill_credentials",
      ...secret.value,
      lifetime,
    });
    assert.equal(filled.clearDisabledCheckpointCount, 2);
    assert.equal(filled.signInEnabled, true);
    assert.equal(filled.submitActionCount, 0);
    markSubmitting();
    await native({ mode: "submit_credentials", lifetime });
  } else {
    const requestID = z.uuid().parse(inspected.requestID);
    assert.equal(secret.kind, "text");
    const value = secret.value;
    markSubmitting();
    await native(
      operation === "verification"
        ? { mode: "verify", code: value, requestID, lifetime }
        : { mode: "connect", vaultPassword: value, requestID, lifetime },
    );
    if (operation === "vault" && checkpoint !== null) {
      await waitReauthorization(status, checkpoint.profileID);
      await validateState(true);
      console.log(
        JSON.stringify({
          runID: manifest.runID,
          lifecycleRound: checkpoint.round,
          originalProfileRetained: true,
          immutableOutboxRetained: true,
          transportRemainsInterrupted: true,
        }),
      );
    }
  }
}
