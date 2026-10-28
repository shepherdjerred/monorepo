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
  vaultPasswordBackend,
} from "tasknotes-macos/scripts/mac-account-contract.ts";
import {
  readHostCredentialItem,
  readHostVaultPassword,
  prepareHostVerificationCode,
  PasswordManagerFailure,
} from "./credential-host.ts";
import { runMacInputProbe, runMacPrivateAction } from "./account-input/host.ts";
import { macVerificationTiming } from "./account-input/protocol.ts";

const LifetimeSchema = z.strictObject({
  startSeconds: z.number().int().nonnegative(),
  startMicroseconds: z.number().int().nonnegative(),
  launchDate: z.number().positive(),
});

type Options = {
  manifest: Extract<Manifest, { schemaVersion: 3 }>;
  operation: Operation;
  parameters: Record<string, string>;
  lifecycleRound?: number;
};
type Prepared = Awaited<ReturnType<typeof prepareContext>>;
type PrivateOperation = Exclude<Operation, "present" | "probe">;
type PrivateContext = { fresh: () => Promise<void>; live: () => void };

/** Real values are read only inside the prepared, both-phase-proved private session callback. */
export async function runHostGuestAccount(options: Options): Promise<number> {
  const submission = { possible: false };
  try {
    const context = await prepareContext(options);
    if (options.operation === "probe") {
      await runMacInputProbe(options.manifest, context.fresh);
      return 0;
    }
    if (options.operation === "present") {
      await presentAccount(context);
      return 0;
    }
    const operation = options.operation;
    const finished = await runMacPrivateAction({
      manifest: options.manifest,
      operation,
      ...context.lifecycleOptions,
      fresh: context.fresh,
      markSubmitting: () => {
        submission.possible = true;
      },
      action: (ctx) => readPreparedAction(operation, context, ctx),
    });
    console.log(JSON.stringify(finished));
    if (operation === "vault" && context.checkpoint !== null) {
      await waitReauthorization(context.status, context.checkpoint.profileID);
      await context.validateState(true);
      console.log(
        JSON.stringify({
          runID: options.manifest.runID,
          lifecycleRound: context.checkpoint.round,
          originalProfileRetained: true,
          immutableOutboxRetained: true,
          transportRemainsInterrupted: true,
        }),
      );
    }
    return 0;
  } catch (error) {
    console.log(
      JSON.stringify({
        blocked:
          error instanceof PasswordManagerFailure
            ? error.classification
            : "guest_account_guard",
        submissionStatus: submission.possible ? "unknown" : "not_attempted",
      }),
    );
    return 3;
  }
}

async function prepareContext(options: Options) {
  const { manifest, operation, parameters, lifecycleRound } = options;
  assert.ok(manifest.allowedRemoteVaultID !== null);
  if (operation === "probe") {
    assert.deepEqual(parameters, {});
    assert.equal(lifecycleRound, undefined);
  }
  if (operation === "verification")
    assert.equal(
      credentialBackend(parameters["--credential-backend"]),
      "keychain",
    );
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
    checkpoint === null ? undefined : await readFile(checkpointPath(directory));
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
  const fresh = async () => {
    await validateState();
  };
  const lifecycleOptions = {
    ...(lifecycleRound === undefined ? {} : { lifecycleRound }),
    ...(checkpointBytes === undefined
      ? {}
      : { lifecycleCheckpoint: encodeBlob(checkpointBytes) }),
  };
  return {
    ...options,
    checkpoint,
    status,
    validateState,
    fresh,
    lifecycleOptions,
  };
}

async function presentAccount(context: Prepared) {
  const { manifest, checkpoint, lifecycleOptions, fresh } = context;
  await fresh();
  const inspected = await requestGuest(manifest, {
    kind: "account",
    action: {
      mode: checkpoint === null ? "inspect_onboarding" : "inspect_workspace",
    },
    ...lifecycleOptions,
  });
  assert.equal(inspected.kind, "account");
  const receipt = z
    .object({ ready: z.literal(true), ...LifetimeSchema.shape })
    .parse(inspected.receipt);
  const lifetime = LifetimeSchema.parse(receipt);
  await fresh();
  const presented = await requestGuest(manifest, {
    kind: "account",
    action: {
      mode:
        checkpoint === null ? "present_account" : "present_lifecycle_account",
      lifetime,
    },
    ...lifecycleOptions,
  });
  assert.equal(presented.kind, "account");
  console.log(JSON.stringify(presented.receipt));
}

async function readPreparedAction(
  operation: PrivateOperation,
  context: Prepared,
  ctx: PrivateContext,
) {
  const { parameters } = context;
  const phase = operation === "vault" ? "vaults" : operation;
  const phaseState = async () => {
    const value = z
      .object({
        accountStage: z.literal(phase),
        accountBusy: z.literal(false),
        accountExchange: z.unknown(),
      })
      .parse(await context.validateState());
    return value.accountExchange;
  };
  const locators = {
    "--account": parameters["--account"] ?? "",
    "--vault": parameters["--vault"] ?? "",
    "--item": parameters["--item"] ?? "",
  };
  const before = await phaseState();
  if (operation === "verification") {
    const source = prepareHostVerificationCode(
      locators,
      "keychain",
      macVerificationTiming,
    );
    await ctx.fresh();
    assert.deepEqual(
      await phaseState(),
      before,
      "Account exchange changed after cached OTP read",
    );
    await source.waitUntilFresh();
    ctx.live();
    return source.issue();
  }
  const value =
    operation === "credentials"
      ? readHostCredentialItem(
          locators,
          credentialBackend(parameters["--credential-backend"]),
        )
      : {
          vaultPassword: readHostVaultPassword(
            parameters["--vault-password-ref"] ?? "",
            vaultPasswordBackend(parameters["--vault-password-backend"]),
          ),
        };
  await ctx.fresh();
  assert.deepEqual(
    await phaseState(),
    before,
    "Account exchange changed after private read",
  );
  ctx.live();
  return value;
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
  return value;
}
