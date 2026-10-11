import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  uuid,
  PendingCheckpoint,
  type Client,
  FileSchema,
  type Manifest,
  digest,
  verifyReplica,
  runDirectory,
  atomicJSON,
} from "./model";
import { save, launch } from "./platform";
import {
  runNativeTest,
  waitForConvergence,
  ownedProfile,
  waitForProfile,
  replicaDirectory,
  control,
} from "./native";
import { augmentFromOfficial } from "./journeys";
import { outboxSnapshot } from "./outbox";

export function taskTitle(bytes: Uint8Array) {
  const source = new TextDecoder().decode(bytes);
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(
    source,
  )?.[1];
  if (frontmatter === undefined)
    throw new Error("Synthetic task lost its frontmatter");
  return z.object({ title: z.string() }).parse(Bun.YAML.parse(frontmatter))
    .title;
}

async function waitForPeer(
  manifest: Manifest,
  peer: Client,
  expected: Manifest["reference"],
) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const profile = await ownedProfile(
      manifest,
      peer,
      false,
      Math.max(1, deadline - Date.now()),
    );
    if (profile.phase === "synced") {
      try {
        await verifyReplica(
          replicaDirectory(manifest, peer, profile.profileID),
          expected,
        );
        return;
      } catch {
        /* Incoming peer files must converge before the other client resumes. */
      }
    }
    await Bun.sleep(500);
  }
  throw new Error("Divergent reference version did not reach the online peer");
}

async function conflictOnClient(manifest: Manifest, client: Client) {
  await waitForConvergence(manifest, manifest.reference);
  const peer = client === "ios" ? "macos" : "ios";
  const profile = await ownedProfile(manifest, client);
  const caseID = crypto.randomUUID().toLowerCase();
  const sourcePath = "Tasks/Existing.md";
  const vault = path.join(runDirectory(manifest.runID), "reference-vault");
  const original = await readFile(path.join(vault, sourcePath));
  const environment = {
    FACET_E2E_CONFLICT_CASE_ID: caseID,
    FACET_E2E_CONFLICT_ORIGINAL_TITLE: taskTitle(original),
  };
  await control(manifest, client, "interrupt", profile.profileID);
  await runNativeTest(
    manifest,
    client,
    "LiveSyncConflictUITests/testEditOwnedTaskWhileOffline",
    { label: `conflict-${client}-edit`, extra: environment },
  );
  await launch(manifest, false, client);
  const offlineProfile = await waitForProfile(manifest, client, "offline");
  if (
    offlineProfile.profileID !== profile.profileID ||
    (offlineProfile.durable?.pendingUploadCount ?? 0) < 1
  )
    throw new Error("Conflict setup lost its pending offline mutation");
  const local = await readFile(
    path.join(
      replicaDirectory(manifest, client, profile.profileID),
      sourcePath,
    ),
  );
  if (taskTitle(local) !== `Facet local conflict ${caseID}`)
    throw new Error("Offline conflict task title did not persist");
  const remote = new TextEncoder().encode(
    original
      .toString("utf8")
      .replace(/^title: .*$/mu, `title: Facet remote conflict ${caseID}`),
  );
  if (taskTitle(remote) !== `Facet remote conflict ${caseID}`)
    throw new Error("Reference conflict title replacement failed");
  await Bun.write(path.join(vault, sourcePath), remote);
  const expected: Manifest["reference"] = {
    ...manifest.reference,
    [sourcePath]: { size: remote.length, sha256: digest(remote) },
  };
  // The other online Facet replica is the evidence that official Obsidian
  // published the divergent version before the disconnected client resumes.
  await waitForPeer(manifest, peer, expected);
  await control(manifest, client, "resume", profile.profileID);
  const conflicted = await waitForProfile(manifest, client, "conflict");
  if ((conflicted.durable?.conflictCount ?? 0) < 1)
    throw new Error("Conflict phase has no durable conflict");
  await runNativeTest(
    manifest,
    client,
    "LiveSyncConflictUITests/testPreviewAndKeepBothVersions",
    { label: `conflict-${client}-resolve`, extra: environment },
  );
  await launch(manifest, false, client);
  expected[`Tasks/Conflict ${caseID}.md`] = {
    size: local.length,
    sha256: digest(local),
  };
  const evidence = await waitForConvergence(manifest, expected);
  manifest.reference = expected;
  await save(manifest);
  await atomicJSON(
    path.join(runDirectory(manifest.runID), `conflict-${client}.json`),
    {
      schemaVersion: 1,
      runID: manifest.runID,
      caseID,
      profileID: profile.profileID,
      clients: evidence,
    },
  );
}

export async function conflicts(manifest: Manifest) {
  if (manifest.cases["initial-download"] !== "pass")
    throw new Error("Verify the initial download first");
  for (const client of ["ios", "macos"] as const)
    await conflictOnClient(manifest, client);
  manifest.cases["concurrent-edits"] = "pass";
  await save(manifest);
}

export async function lifecycleBegin(manifest: Manifest, client: Client) {
  await waitForConvergence(manifest, manifest.reference);
  const profile = await ownedProfile(manifest, client);
  await control(manifest, client, "interrupt", profile.profileID);
  await runNativeTest(
    manifest,
    client,
    "LiveSyncVaultUITests/testOfflineCaptureEditAndColdRelaunchRetainPendingChanges",
    {
      label: `lifecycle-${client}-pending`,
      extra: {
        FACET_E2E_ROUND: String(manifest.round),
        FACET_E2E_CAPTURE_PREFIX: "Lifecycle",
      },
    },
  );
  await launch(manifest, false, client);
  const before = await waitForProfile(manifest, client, "offline");
  const pendingCount = before.durable?.pendingUploadCount ?? 0;
  if (before.profileID !== profile.profileID || pendingCount < 1)
    throw new Error("Lifecycle setup lost its pending replica mutation");
  const outbox = await outboxSnapshot(manifest, client, before.profileID);
  if (outbox.count !== pendingCount)
    throw new Error("Lifecycle durable status and outbox snapshot differ");
  const title = `Lifecycle ${client === "ios" ? "iOS" : "macOS"} ${manifest.runID}-${String(manifest.round)} edited`;
  const expected = await augmentFromOfficial(
    manifest,
    [title],
    false,
    replicaDirectory(manifest, client, profile.profileID),
  );
  await verifyReplica(
    replicaDirectory(manifest, client, profile.profileID),
    expected,
  );
  await runNativeTest(
    manifest,
    client,
    "LiveSyncLifecycleUITests/testSignOutPreservesPendingTaskAndColdReplica",
    {
      label: `lifecycle-${client}-signedout`,
      extra: { FACET_E2E_LIFECYCLE_TITLE: title },
    },
  );
  await launch(manifest, false, client);
  const after = await waitForProfile(
    manifest,
    client,
    "reconnectRequired",
    true,
  );
  if (
    after.profileID !== before.profileID ||
    after.durable?.pendingUploadCount !== pendingCount
  )
    throw new Error(
      "Sign-out replaced the replica or lost its pending uploads",
    );
  const signedOutOutbox = await outboxSnapshot(
    manifest,
    client,
    after.profileID,
  );
  if (JSON.stringify(signedOutOutbox) !== JSON.stringify(outbox))
    throw new Error("Sign-out changed immutable outbox operation identities");
  await verifyReplica(
    replicaDirectory(manifest, client, profile.profileID),
    expected,
  );
  await atomicJSON(
    path.join(
      runDirectory(manifest.runID),
      `lifecycle-${client}-checkpoint.json`,
    ),
    {
      schemaVersion: 1,
      runID: manifest.runID,
      round: manifest.round,
      profileID: profile.profileID,
      pendingCount,
      outbox,
      title,
      expected,
    },
  );
  console.log(
    `${client}: sign-out and cold relaunch preserved exact replica bytes and pending uploads. Recording is stopped. Sign in manually and reconnect the EXISTING profile, then run lifecycle-finish ${manifest.runID} ${client}.`,
  );
}

export async function lifecycleFinish(manifest: Manifest, client: Client) {
  const directory = runDirectory(manifest.runID);
  const checkpoint = z
    .strictObject({
      schemaVersion: z.literal(1),
      runID: uuid,
      round: z.number().int(),
      profileID: uuid,
      pendingCount: z.number().int().positive(),
      outbox: z.object({
        count: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      }),
      title: z.string(),
      expected: z.record(z.string(), FileSchema),
    })
    .parse(
      await Bun.file(
        path.join(directory, `lifecycle-${client}-checkpoint.json`),
      ).json(),
    );
  if (
    checkpoint.runID !== manifest.runID ||
    checkpoint.round !== manifest.round
  )
    throw new Error("Lifecycle checkpoint belongs to another run or round");
  const profile = await ownedProfile(manifest, client, true);
  if (
    profile.remoteVaultID === null ||
    profile.phase === "reconnectRequired" ||
    profile.phase === "connecting"
  )
    throw new PendingCheckpoint(
      "Sign in manually and reconnect the existing profile before lifecycle-finish",
    );
  if (
    profile.profileID !== checkpoint.profileID ||
    profile.remoteVaultID !== manifest.allowedRemoteVaultID
  )
    throw new Error(
      "Reauthorization did not retain the existing bound replica",
    );
  await verifyReplica(
    replicaDirectory(manifest, client, profile.profileID),
    checkpoint.expected,
  );
  const reauthorizedOutbox = await outboxSnapshot(
    manifest,
    client,
    profile.profileID,
  );
  if (
    profile.durable?.pendingUploadCount !== checkpoint.pendingCount ||
    JSON.stringify(reauthorizedOutbox) !== JSON.stringify(checkpoint.outbox)
  )
    throw new Error(
      "Reauthorization changed the original immutable outbox before drain",
    );
  await control(manifest, client, "resume", profile.profileID);
  const evidence = await waitForConvergence(manifest, checkpoint.expected);
  manifest.reference = checkpoint.expected;
  await save(manifest);
  await runNativeTest(
    manifest,
    client,
    "LiveSyncLifecycleUITests/testReauthorizedReplicaRetainsTaskAndColdRelaunch",
    {
      label: `lifecycle-${client}-reauthorized`,
      extra: { FACET_E2E_LIFECYCLE_TITLE: checkpoint.title },
    },
  );
  await launch(manifest, false, client);
  await waitForConvergence(manifest, manifest.reference);
  await atomicJSON(path.join(directory, `lifecycle-${client}-pass.json`), {
    schemaVersion: 1,
    runID: manifest.runID,
    round: manifest.round,
    profileID: checkpoint.profileID,
    clients: evidence,
  });
  if (
    (await Bun.file(
      path.join(directory, "lifecycle-ios-pass.json"),
    ).exists()) &&
    (await Bun.file(path.join(directory, "lifecycle-macos-pass.json")).exists())
  ) {
    const passes = await Promise.all(
      (["ios", "macos"] as const).map(async (platform) =>
        z
          .object({ runID: uuid, round: z.number().int() })
          .parse(
            await Bun.file(
              path.join(directory, `lifecycle-${platform}-pass.json`),
            ).json(),
          ),
      ),
    );
    if (
      passes.every(
        (pass) =>
          pass.runID === manifest.runID && pass.round === manifest.round,
      )
    ) {
      manifest.cases["session-lifecycle"] = "pass";
      await save(manifest);
    }
  }
}
