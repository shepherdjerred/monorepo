import assert from "node:assert/strict";
import { z } from "zod";
import {
  readHostCredentialItem,
  readHostVerificationCode,
  readHostVaultPassword,
} from "../apple-sync-live/transport/execution/credential-host";
import { launch } from "../apple-sync-live/platform";
import type { Manifest } from "../apple-sync-live/model";
import { requireIosPrivateInputProof } from "./probe";
import { executePrivateAccountSession } from "./run-session";
import { accountCheckpoint, validateAccountState } from "./state";

const locator = z.string().regex(/^[A-Za-z0-9]{20,32}$/u);
export const IOSAccountOptionsSchema = z.strictObject({
  account: locator,
  vault: locator,
  item: locator,
  credentialBackend: z
    .enum(["keychain", "service-account", "desktop"])
    .default("keychain"),
  vaultPasswordRef: z
    .string()
    .regex(/^op:\/\/[A-Za-z0-9]{20,32}\/[A-Za-z0-9]{20,32}\/password$/u),
  vaultPasswordBackend: z
    .enum(["service-account", "desktop"])
    .default("service-account"),
  lifecycleRound: z.number().int().min(1).max(3).optional(),
});
export type IOSAccountOptions = z.infer<typeof IOSAccountOptionsSchema>;

export async function runIosAccountAuthentication(
  manifest: Manifest,
  options: IOSAccountOptions,
) {
  assert.ok(
    manifest.schemaVersion === 3 &&
      manifest.scope === "apple" &&
      manifest.allowedRemoteVaultID !== null,
  );
  const settings = IOSAccountOptionsSchema.parse(options);
  await requireIosPrivateInputProof(manifest);
  const checkpoint = await accountCheckpoint(manifest, settings.lifecycleRound);
  await validateAccountState(manifest, checkpoint);
  const locators = {
    "--account": settings.account,
    "--vault": settings.vault,
    "--item": settings.item,
  };
  const remoteVaultID = manifest.allowedRemoteVaultID;
  const observed = await executePrivateAccountSession(manifest, {
    operation: "credentials",
    ...(checkpoint === undefined
      ? {}
      : { originalProfileID: checkpoint.profileID }),
    action: async (session) => {
      if (session.stage === "credentials") {
        const credentials = readHostCredentialItem(
          locators,
          settings.credentialBackend,
        );
        await validateAccountState(manifest, checkpoint);
        await session.fill(credentials);
        await session.submit();
        await session.observe();
      }
      if (session.stage === "verification") {
        const before = await validateAccountState(manifest, checkpoint);
        const code = readHostVerificationCode(
          locators,
          settings.credentialBackend,
        );
        const after = await validateAccountState(manifest, checkpoint);
        assert.deepEqual(
          after["accountExchange"],
          before["accountExchange"],
          "Account challenge changed during password-manager approval",
        );
        await session.fillVerification(code);
        await session.submitVerification();
        await session.observe();
      }
      assert.equal(
        session.stage,
        "vaults",
        "Obsidian did not reach a settled vault-selection state",
      );
      if (!session.canConnectWithoutPassword) {
        const before = await validateAccountState(manifest, checkpoint);
        const password = readHostVaultPassword(
          settings.vaultPasswordRef,
          settings.vaultPasswordBackend,
        );
        const after = await validateAccountState(manifest, checkpoint);
        assert.deepEqual(
          after["accountExchange"],
          before["accountExchange"],
          "Account ownership changed during vault-password approval",
        );
        await session.fillVaultPassword(password);
      }
      await session.connect(remoteVaultID, checkpoint?.profileID);
      await session.observe();
      assert.equal(
        session.stage,
        "connected",
        "The owned account sheet did not complete vault connection",
      );
      const status = await validateAccountState(manifest, checkpoint, true);
      const profile = status.profiles[0];
      assert.ok(profile !== undefined);
      const finished = await session.finish();
      return {
        profileID: profile.profileID,
        remoteVaultID,
        submitActionCount: finished.submitActionCount,
      };
    },
  });
  // Finish follows proven settled authentication. Relaunch resumes its owned Sync worker;
  // queue drainage and the complete replica matrix remain separate acceptance gates.
  await launch(manifest, false, "ios");
  await validateAccountState(manifest, checkpoint, true);
  const receipt = z
    .strictObject({
      profileID: z.uuid(),
      remoteVaultID: z.string().min(1).max(256),
      submitActionCount: z.number().int().min(1).max(3),
    })
    .safeParse(observed.receipt);
  if (!receipt.success)
    throw new Error("Private iOS account returned an unsupported receipt");
  return {
    runID: manifest.runID,
    status: "authenticated-owned-vault",
    profileID: receipt.data.profileID,
    syncAcceptance: "pending-matrix",
  };
}
