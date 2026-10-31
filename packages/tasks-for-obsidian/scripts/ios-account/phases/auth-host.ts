import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { IOSAccountOptions } from "../authenticate";
import type { Manifest } from "../../apple-sync-live/model";
import { digest } from "../../apple-sync-live/model";
import {
  readHostCredentialItem,
  prepareHostVerificationCode,
} from "../../apple-sync-live/transport/execution/credential-host";
import { requireIosPrivateInputProof } from "../probe";
import { accountCheckpoint, validateAccountState } from "../state";
import { executePrivateAccountSession } from "../run-session";
import { inputBundle } from "../app-input-artifacts";
import { VerificationTiming } from "../contract";
import { authenticateOnly } from "./authentication";
import {
  accountOwnerSnapshot,
  mapDigest,
  proofDigests,
  reservePhase,
  saveAuthCheckpoint,
} from "./checkpoint";

export async function runIosAuthOnly(
  manifest: Manifest,
  settings: IOSAccountOptions,
) {
  const proof = await requireIosPrivateInputProof(manifest);
  const lifecycle = await accountCheckpoint(manifest, settings.lifecycleRound);
  const initial = await validateAccountState(manifest, lifecycle);
  assert.ok(
    initial.accountStage === "credentials" ||
      initial.accountStage === "verification",
  );
  await reservePhase(manifest, "auth-only", settings.lifecycleRound);
  const locators = {
    "--account": settings.account,
    "--vault": settings.vault,
    "--item": settings.item,
  };
  const observed = await executePrivateAccountSession(manifest, {
    operation: "auth-only",
    runnerFiles: proof.credentials.runnerFiles,
    ...(lifecycle === undefined
      ? {}
      : { originalProfileID: lifecycle.profileID }),
    action: async (session) => ({
      ...(await authenticateOnly(session, {
        validate: () => validateAccountState(manifest, lifecycle),
        readAccount: () =>
          readHostCredentialItem(locators, settings.credentialBackend),
        verification: () =>
          prepareHostVerificationCode(
            locators,
            settings.credentialBackend,
            VerificationTiming,
          ),
      })),
      owner: await accountOwnerSnapshot(manifest),
    }),
  });
  const receipt = z
    .object({
      submitActionCount: z.number().int().min(1).max(2),
      owner: z.object({
        ownerBindingSHA256: z.string(),
        metadataSHA256: z.string(),
        profileCount: z.number().int(),
      }),
    })
    .parse(observed.receipt);
  assert.deepEqual(await accountOwnerSnapshot(manifest), receipt.owner);
  const phaseProofs = await proofDigests(manifest);
  await saveAuthCheckpoint(
    manifest,
    {
      schemaVersion: 1,
      kind: "ios-account-auth-only-checkpoint",
      runID: manifest.runID,
      sourceHead: observed.sourceHead,
      remoteVaultID: z.string().parse(manifest.allowedRemoteVaultID),
      ...receipt.owner,
      authEntryID: observed.probeID,
      authSessionID: observed.sessionID,
      authOutcomeSHA256: digest(
        await readFile(path.join(observed.evidence, "outcome.json")),
      ),
      authEvidenceSHA256: mapDigest(await inputBundle(observed.evidence)),
      sourceFilesSHA256: mapDigest(observed.sourceFiles),
      appFilesSHA256: mapDigest(observed.appFiles),
      runnerFilesSHA256: mapDigest(observed.runnerFiles),
      inputArtifactsSHA256: mapDigest(observed.appInputFiles),
      phaseProofs,
    },
    settings.lifecycleRound,
  );
  return {
    runID: manifest.runID,
    status: "authenticated-account-awaiting-vault",
    submitActionCount: receipt.submitActionCount,
  };
}
