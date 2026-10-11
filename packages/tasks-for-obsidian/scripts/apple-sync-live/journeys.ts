import { readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type Manifest,
  settledProfile,
  digest,
  runDirectory,
  atomicJSON,
  verifyReplica,
} from "./model";
import { save, launch, statuses } from "./platform";
import {
  runNativeTest,
  waitForConvergence,
  control,
  ownedProfile,
  replicaDirectory,
} from "./native";
import { assertCurrentConfigurationProof } from "./configuration";
import { outboxSnapshot } from "./outbox";
import {
  assertOfflinePending,
  assertUnchangedOfflineOutbox,
} from "./offline-proof";

export async function augmentFromOfficial(
  manifest: Manifest,
  titles: string[],
  highPriority = false,
  directory?: string,
) {
  const vault =
    directory ?? path.join(runDirectory(manifest.runID), "reference-vault");
  const expected = { ...manifest.reference };
  const matches = new Set<string>();
  for (const relative of new Bun.Glob("**/*.md").scanSync({
    cwd: vault,
    dot: true,
  })) {
    if (relative in manifest.reference) continue;
    const bytes = await readFile(path.join(vault, relative));
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(
      bytes.toString("utf8"),
    )?.[1];
    if (frontmatter === undefined)
      throw new Error("Unexpected unstructured reference note");
    const task = z
      .object({
        title: z.string(),
        status: z.literal("open"),
        priority: z.string(),
        completedDate: z.null().optional(),
      })
      .parse(Bun.YAML.parse(frontmatter));
    if (
      !titles.includes(task.title) ||
      matches.has(task.title) ||
      (highPriority && task.priority !== "high")
    )
      throw new Error("Unexpected or duplicate live native task");
    matches.add(task.title);
    expected[relative] = { size: bytes.length, sha256: digest(bytes) };
  }
  if (matches.size !== titles.length)
    throw new Error("Official reference is still missing native task changes");
  return expected;
}

export async function waitForNativeTasks(
  manifest: Manifest,
  titles: string[],
  highPriority = false,
) {
  const deadline = Date.now() + 120_000;
  let lastFailure = "Missing native tasks";
  while (Date.now() < deadline) {
    try {
      const expected = await augmentFromOfficial(
        manifest,
        titles,
        highPriority,
      );
      const evidence = await waitForConvergence(
        manifest,
        expected,
        Math.max(1, deadline - Date.now()),
      );
      manifest.reference = expected;
      await save(manifest);
      return evidence;
    } catch (error) {
      lastFailure =
        error instanceof Error
          ? error.message
          : "Native task verification failed";
    }
    await Bun.sleep(500);
  }
  throw new Error(`Native task convergence deadline exceeded: ${lastFailure}`);
}

export async function journeys(manifest: Manifest) {
  assertCurrentConfigurationProof(
    manifest,
    await Bun.file(
      path.join(runDirectory(manifest.runID), "settings-changed.json"),
    ).json(),
  );
  await waitForConvergence(manifest, manifest.reference);
  const round = manifest.round;
  for (const client of ["ios", "macos"] as const) {
    const label = `capture-${client}-${String(round)}`;
    console.log(`Starting ${label}; authentication must already be complete.`);
    await runNativeTest(
      manifest,
      client,
      "LiveSyncVaultUITests/testCaptureEditCompleteUncompleteAndColdRelaunch",
      { label, extra: { FACET_E2E_ROUND: String(round) } },
    );
    await launch(manifest, false, client);
    const title = `Live ${client === "ios" ? "iOS" : "macOS"} ${manifest.runID}-${String(round)} edited`;
    const evidence = await waitForNativeTasks(manifest, [title], true);
    await atomicJSON(
      path.join(
        runDirectory(manifest.runID),
        "journeys",
        `round-${String(round)}`,
        label,
        "convergence.json",
      ),
      { schemaVersion: 1, runID: manifest.runID, round, clients: evidence },
    );
  }
  manifest.cases["bidirectional-changes"] = "pass";
  manifest.cases.configuration = "pass";
  await save(manifest);
  console.log(
    `Native task journeys passed on both clients for round ${String(round)}. Complete acceptance still requires every other case in this round.`,
  );
}

export async function referenceChange(
  manifest: Manifest,
  relative: string,
  bytes: Uint8Array | null,
  label: string,
) {
  const vault = path.join(runDirectory(manifest.runID), "reference-vault");
  if (
    relative !== ".obsidian/plugins/tasknotes/data.json" &&
    !relative.startsWith("Tasks/") &&
    !relative.startsWith("Attachments/")
  )
    throw new Error(
      "Reference change target is not an acceptance task, attachment or its settings",
    );
  const expected = Object.fromEntries(
    Object.entries(manifest.reference).filter(
      ([key]) => bytes !== null || key !== relative,
    ),
  );
  if (bytes === null) {
    await unlink(path.join(vault, relative));
  } else {
    await Bun.write(path.join(vault, relative), bytes);
    expected[relative] = { size: bytes.length, sha256: digest(bytes) };
  }
  const evidence = await waitForConvergence(manifest, expected);
  manifest.reference = expected;
  await save(manifest);
  await atomicJSON(path.join(runDirectory(manifest.runID), `${label}.json`), {
    schemaVersion: 1,
    runID: manifest.runID,
    round: manifest.round,
    changedPath: relative,
    expectedFingerprint: expected[relative] ?? null,
    clients: evidence,
  });
}

export async function referenceChanges(manifest: Manifest) {
  if (manifest.cases["initial-download"] !== "pass")
    throw new Error("Verify the initial download first");
  const relative = `Tasks/Official ${manifest.runID}.md`;
  const title = `Official ${manifest.runID}`;
  const task = (edited: boolean, done: boolean) =>
    new TextEncoder().encode(
      `---\ntitle: ${title}${edited ? " edited" : ""}\nstatus: ${done ? "done" : "open"}\npriority: normal\ntags: [task]\ndateCreated: 2026-10-01T00:00:00Z\ndateModified: 2026-10-11T00:00:00Z\n${done ? "completedDate: 2026-10-11\n" : ""}---\nOfficial client reference sentinel.\n`,
    );
  await referenceChange(
    manifest,
    relative,
    task(false, false),
    "official-created",
  );
  await referenceChange(
    manifest,
    relative,
    task(true, false),
    "official-edited",
  );
  await referenceChange(
    manifest,
    relative,
    task(true, true),
    "official-completed",
  );
  await referenceChange(
    manifest,
    relative,
    task(true, false),
    "official-uncompleted",
  );
  const destination = `Tasks/Official renamed ${manifest.runID}.md`;
  const vault = path.join(runDirectory(manifest.runID), "reference-vault");
  await rename(path.join(vault, relative), path.join(vault, destination));
  const expected = Object.fromEntries(
    Object.entries(manifest.reference).filter(([key]) => key !== relative),
  );
  const fingerprint = manifest.reference[relative];
  if (fingerprint === undefined)
    throw new Error("Reference rename has no known source");
  expected[destination] = fingerprint;
  const renameEvidence = await waitForConvergence(manifest, expected);
  manifest.reference = expected;
  await save(manifest);
  await atomicJSON(
    path.join(runDirectory(manifest.runID), "official-renamed.json"),
    { schemaVersion: 1, runID: manifest.runID, clients: renameEvidence },
  );
  await referenceChange(manifest, destination, null, "official-deleted");
  manifest.cases["file-operations"] = "pass";
  await save(manifest);
  const settingsPath = ".obsidian/plugins/tasknotes/data.json";
  const settings = z
    .record(z.string(), z.unknown())
    .parse(await Bun.file(path.join(vault, settingsPath)).json());
  await referenceChange(
    manifest,
    settingsPath,
    new TextEncoder().encode(
      `${JSON.stringify({ ...settings, defaultTaskPriority: "normal" }, null, 2)}\n`,
    ),
    "settings-reset",
  );
  await referenceChange(
    manifest,
    settingsPath,
    new TextEncoder().encode(
      `${JSON.stringify({ ...settings, defaultTaskPriority: "high" }, null, 2)}\n`,
    ),
    "settings-changed",
  );
  const binary = Uint8Array.from(
    { length: 2 * 1024 * 1024 + 1024 },
    (_, index) => (index + manifest.round) % 251,
  );
  await referenceChange(
    manifest,
    "Attachments/multi-piece.bin",
    binary,
    "binary-changed",
  );
  manifest.cases["binary-changes"] = "pass";
  await save(manifest);
  console.log(
    "Reference-folder create/edit/complete/uncomplete/rename/delete converged through official Obsidian Sync transport. This does not assert official TaskNotes UI interaction. Plugin settings changed; native high-priority captures must still prove configuration application.",
  );
}

export async function offline(manifest: Manifest) {
  if (manifest.cases["initial-download"] !== "pass")
    throw new Error("Verify the initial download first");
  for (const client of ["ios", "macos"] as const) {
    const current = await statuses(manifest);
    const entry = current.find((item) => item.client === client);
    if (entry === undefined || manifest.allowedRemoteVaultID === null)
      throw new Error("Missing bound client");
    const profile = settledProfile(
      entry.value,
      manifest.runID,
      manifest.allowedRemoteVaultID,
      Date.now(),
    );
    await control(manifest, client, "interrupt", profile.profileID);
    await runNativeTest(
      manifest,
      client,
      "LiveSyncVaultUITests/testOfflineCaptureEditAndColdRelaunchRetainPendingChanges",
      {
        label: `offline-${client}`,
        extra: { FACET_E2E_ROUND: String(manifest.round) },
      },
    );
    await launch(manifest, false, client);
    const title = `Offline ${client === "ios" ? "iOS" : "macOS"} ${manifest.runID}-${String(manifest.round)} edited`;
    const deadline = Date.now() + 120_000;
    const before = await ownedProfile(manifest, client, false);
    const outbox = assertOfflinePending(
      before,
      profile.profileID,
      manifest.allowedRemoteVaultID,
      await outboxSnapshot(manifest, client, profile.profileID),
    );
    const replica = replicaDirectory(manifest, client, profile.profileID);
    const retained = await augmentFromOfficial(
      manifest,
      [title],
      false,
      replica,
    );
    await verifyReplica(replica, retained);
    const after = await ownedProfile(
      manifest,
      client,
      false,
      Math.max(1, deadline - Date.now()),
    );
    assertUnchangedOfflineOutbox(
      outbox,
      assertOfflinePending(
        after,
        profile.profileID,
        manifest.allowedRemoteVaultID,
        await outboxSnapshot(manifest, client, profile.profileID),
      ),
    );
    if (Date.now() >= deadline)
      throw new Error("Offline proof deadline exceeded");
    await atomicJSON(
      path.join(runDirectory(manifest.runID), `offline-${client}-pending.json`),
      {
        schemaVersion: 1,
        runID: manifest.runID,
        round: manifest.round,
        profileID: profile.profileID,
        outbox,
        expected: retained,
      },
    );
    await control(manifest, client, "resume", profile.profileID);
    const evidence = await waitForNativeTasks(manifest, [title]);
    await atomicJSON(
      path.join(runDirectory(manifest.runID), `offline-${client}.json`),
      {
        schemaVersion: 1,
        runID: manifest.runID,
        round: manifest.round,
        clients: evidence,
      },
    );
  }
  manifest.cases["offline-recovery"] = "pass";
  await save(manifest);
}
