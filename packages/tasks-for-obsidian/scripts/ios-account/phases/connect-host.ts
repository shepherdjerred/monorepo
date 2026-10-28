import assert from "node:assert/strict";
import { z } from "zod";
import type { IOSVaultOptions } from "../authenticate";
import type { Manifest } from "../../apple-sync-live/model";
import { launch } from "../../apple-sync-live/platform";
import { readHostVaultPassword } from "../../apple-sync-live/transport/execution/credential-host";
import { requireIosPrivateInputProof } from "../probe";
import { accountCheckpoint, validateAccountState } from "../state";
import { executePrivateAccountSession } from "../run-session";
import { connectOnly } from "./connection";
import {
  accountOwnerSnapshot,
  assertAuthCheckpointAuthority,
  mapDigest,
  proofDigests,
  readAuthCheckpoint,
  reservePhase,
} from "./checkpoint";
import { awaitFreshIOSPublication } from "./readiness";

export async function runIosConnectOnly(
  manifest: Manifest,
  settings: IOSVaultOptions,
) {
  const proof = await requireIosPrivateInputProof(manifest);
  const checkpoint = await readAuthCheckpoint(
    manifest,
    settings.lifecycleRound,
  );
  const authority = {
    runID: manifest.runID,
    sourceHead: proof.credentials.sourceHead,
    remoteVaultID: z.string().parse(manifest.allowedRemoteVaultID),
    sourceFilesSHA256: mapDigest(proof.credentials.sourceFiles),
    appFilesSHA256: mapDigest(proof.credentials.appFiles),
    runnerFilesSHA256: mapDigest(proof.credentials.runnerFiles),
    inputArtifactsSHA256: mapDigest(proof.credentials.appInputFiles),
    phaseProofs: await proofDigests(manifest),
  };
  assertAuthCheckpointAuthority(checkpoint, {
    ...authority,
    ...(await accountOwnerSnapshot(manifest)),
  });
  const lifecycle = await accountCheckpoint(manifest, settings.lifecycleRound);
  await reservePhase(manifest, "connect-only", settings.lifecycleRound);
  const launchedAt = Date.now();
  await launch(manifest, false, "ios");
  await awaitFreshIOSPublication(manifest, launchedAt);
  const admit = async () => {
    const current = await readAuthCheckpoint(manifest, settings.lifecycleRound);
    assert.deepEqual(current, checkpoint);
    const status = await validateAccountState(manifest, lifecycle);
    assert.equal(status.accountStage, "vaults");
    assert.equal(status.accountBusy, false);
    assert.equal(status.profiles.length, lifecycle === undefined ? 0 : 1);
    assertAuthCheckpointAuthority(checkpoint, {
      ...authority,
      ...(await accountOwnerSnapshot(manifest)),
    });
    return status;
  };
  await admit();
  const remoteVaultID = z.string().parse(manifest.allowedRemoteVaultID);
  const observed = await executePrivateAccountSession(manifest, {
    operation: "connect-only",
    runnerFiles: proof.credentials.runnerFiles,
    ...(lifecycle === undefined
      ? {}
      : { originalProfileID: lifecycle.profileID }),
    action: (session) =>
      connectOnly(session, remoteVaultID, lifecycle?.profileID, {
        admit,
        readVaultPassword: () =>
          readHostVaultPassword(
            settings.vaultPasswordRef,
            settings.vaultPasswordBackend,
          ),
        connected: async () => {
          const status = await validateAccountState(manifest, lifecycle, true);
          const owner = await accountOwnerSnapshot(manifest);
          assert.equal(owner.ownerBindingSHA256, checkpoint.ownerBindingSHA256);
          return status;
        },
      }),
  });
  const receipt = z
    .strictObject({
      profileID: z.uuid(),
      remoteVaultID: z.literal(remoteVaultID),
      submitActionCount: z.literal(1),
    })
    .parse(observed.receipt);
  await launch(manifest, false, "ios");
  await validateAccountState(manifest, lifecycle, true);
  return {
    runID: manifest.runID,
    status: "authenticated-owned-vault",
    profileID: receipt.profileID,
    syncAcceptance: "pending-matrix",
  };
}
