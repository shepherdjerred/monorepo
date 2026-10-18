import { createHash } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { S3Client } from "bun";
import { z } from "zod";
import {
  ForumReleaseIdSchema,
  parseForumRecoveryAction,
} from "@shepherdjerred/ops-model/forum-recovery.ts";
import { forumManifest, StageSchema } from "./config.ts";
import {
  beginStormForumBackup,
  endStormForumBackup,
  snapshotForum,
} from "./backup.ts";
import { SnapshotEnvironmentSchema, SnapshotSourceSchema } from "./storage.ts";
import { SnapshotSchema } from "./restore.ts";
import {
  executeForumReleaseStep,
  observeForumInstallation,
  originalForumSource,
  validateVendorBundle,
  verifyForumRelease,
} from "./release.ts";
import {
  ForumReleaseJournalSchema,
  forumResumeStep,
  runForumReleaseSteps,
  writeForumReleaseJournal,
  acknowledgeForumReleaseStep,
  type ForumReleaseJournal,
} from "./release-journal.ts";
import { runPhp } from "./process.ts";

const Lock = z.strictObject({
  stage: StageSchema,
  owner: z.uuid(),
  startedAt: z.iso.datetime(),
});
const Maintenance = z.strictObject({ owner: z.uuid(), startedAt: z.number() });
const LOCK = "/var/lib/storm-forum/.release-lock";
const MARKER = "/var/lib/storm-forum/.maintenance";

export async function verifyOriginalForumBackup(
  journal: ForumReleaseJournal,
): Promise<void> {
  if (journal.original === null) {
    if (journal.originalSnapshot !== null)
      throw new Error("Empty installation has an unexpected original snapshot");
    return;
  }
  const env = SnapshotEnvironmentSchema.parse(Bun.env);
  const client = new S3Client({
    endpoint: env.BACKUP_ENDPOINT,
    bucket: env.BACKUP_BUCKET,
    accessKeyId: env.BACKUP_ACCESS_KEY,
    secretAccessKey: env.BACKUP_SECRET_KEY,
    region: "us-east-1",
  });
  const prefix = `snapshots/${journal.stage}/${journal.owner}`;
  if (journal.originalSnapshot !== `${prefix}/manifest.json`)
    throw new Error(
      "Forum original backup does not belong to its original maintenance owner",
    );
  const manifest = SnapshotSchema.parse(
    await client.file(journal.originalSnapshot).json(),
  );
  const source = SnapshotSourceSchema.parse(
    await client.file(`${prefix}/source-release.json`).json(),
  );
  if (
    manifest.stage !== journal.stage ||
    manifest.owner !== journal.owner ||
    manifest.bundleSha256 !== journal.original.bundleSha256 ||
    manifest.xenforoVersion !== journal.original.xenforoVersion ||
    JSON.stringify(source) !== JSON.stringify(journal.original) ||
    manifest.payloads
      .map((p) => p.key)
      .sort()
      .join("|") !==
      [`${prefix}/database.sql`, `${prefix}/files.tar.gz`].join("|")
  )
    throw new Error("Forum committed original backup identity changed");
  for (const payload of manifest.payloads) {
    let bytes = 0;
    const hash = createHash("sha256");
    for await (const chunk of client.file(payload.key).stream()) {
      bytes += chunk.byteLength;
      if (bytes > payload.bytes)
        throw new Error("Forum original backup exceeds committed size");
      hash.update(chunk);
    }
    if (bytes !== payload.bytes || hash.digest("hex") !== payload.sha256)
      throw new Error(
        "Forum original backup bytes differ from the committed snapshot",
      );
  }
}

async function requireOwner(journal: ForumReleaseJournal): Promise<void> {
  const lock = Lock.parse(await Bun.file(LOCK).json());
  const marker = Maintenance.parse(await Bun.file(MARKER).json());
  if (
    lock.owner !== journal.owner ||
    lock.stage !== journal.stage ||
    marker.owner !== journal.owner
  )
    throw new Error(
      "Forum maintenance or release lock belongs to another native execution",
    );
}
async function requireCleanupOwner(
  journal: ForumReleaseJournal,
): Promise<void> {
  if (await Bun.file(LOCK).exists()) {
    const lock = Lock.parse(await Bun.file(LOCK).json());
    if (lock.owner !== journal.owner || lock.stage !== journal.stage)
      throw new Error(
        "Forum cleanup release lock belongs to another execution",
      );
  }
  if (
    (await Bun.file(MARKER).exists()) &&
    Maintenance.parse(await Bun.file(MARKER).json()).owner !== journal.owner
  )
    throw new Error("Forum cleanup maintenance belongs to another execution");
}

/** Invoked only by an operator-created exact copy of the original terminal Job.
 * No source, command, snapshot, owner or candidate can be supplied by the caller.
 */
export async function recoverForumRelease(): Promise<void> {
  const env = z
    .object({
      FORUM_RECOVERY_INTENT_ID: z
        .string()
        .min(1)
        .max(160)
        .regex(/^[a-z0-9][\w.:/-]*$/iu),
      FORUM_RECOVERY_ACTION: z.string().transform(parseForumRecoveryAction),
      FORUM_RELEASE_ID: ForumReleaseIdSchema,
      STORM_FORUM_STAGE: StageSchema,
      RUNTIME_IMAGE: SnapshotSourceSchema.shape.runtimeImage,
      BUNDLE_SHA256: SnapshotSourceSchema.shape.bundleSha256,
    })
    .parse(Bun.env);
  const file = `/var/lib/storm-forum/.release-journals/${env.FORUM_RELEASE_ID}.json`;
  if (!(await Bun.file(file).exists()))
    throw new Error(
      "Legacy Forum release has no native phase journal; inspect its retained original Job/backup and use reviewed native repair, never remove markers or retry a migration blindly",
    );
  const journal = ForumReleaseJournalSchema.parse(await Bun.file(file).json());
  if (
    journal.stage !== env.STORM_FORUM_STAGE ||
    journal.candidate.runtimeImage !== env.RUNTIME_IMAGE ||
    journal.candidate.bundleSha256 !== env.BUNDLE_SHA256 ||
    journal.candidate.xenforoVersion !== forumManifest.xenforoVersion
  )
    throw new Error(
      "Forum recovery candidate differs from the exact original native release",
    );
  const { action, acknowledgement } = env.FORUM_RECOVERY_ACTION;
  if (acknowledgement !== undefined) {
    await requireOwner(journal);
    await validateVendorBundle();
    await verifyOriginalForumBackup(journal);
    await acknowledgeForumReleaseStep(
      file,
      journal,
      acknowledgement,
      async (step) => {
        const result = await runPhp([
          "/opt/storm-forum/runtime/recovery-step-verify.php",
          step,
        ]);
        if (result.trim() !== "verified")
          throw new Error(
            "Forum interrupted step has no exact native completion proof",
          );
        await requireOwner(journal);
      },
    );
  }
  if (action === "inspect") await inspectForumJournal(journal);
  else await repairForumJournal(file, journal);
  let safe = true;
  try {
    forumResumeStep(journal);
  } catch {
    safe = false;
  }
  await Bun.write(
    Bun.stdout,
    `FORUM_RECOVERY_RESULT_V1=${JSON.stringify({
      intentId: env.FORUM_RECOVERY_INTENT_ID,
      owner: journal.owner,
      phase: journal.phase,
      step: journal.step,
      journalSha256: createHash("sha256")
        .update(await Bun.file(file).text())
        .digest("hex"),
      safeToResume: safe,
      settled: journal.phase === "complete",
      observedAt: new Date().toISOString(),
    })}\n`,
  );
}

async function inspectForumJournal(
  journal: ForumReleaseJournal,
): Promise<void> {
  const locked = await Bun.file(LOCK).exists();
  const maintenance = await Bun.file(MARKER).exists();
  if (journal.phase === "complete") {
    if (locked || maintenance)
      throw new Error("Completed Forum journal still has a native lock");
    await verifyForumRelease(journal);
  } else if (journal.phase === "verified") await requireCleanupOwner(journal);
  else if (locked || maintenance) await requireOwner(journal);
  else if (journal.completed.length > 0 || journal.phase === "mutating")
    throw new Error(
      "Forum interrupted mutation lost its native ownership markers",
    );
  if (journal.originalSnapshot !== null)
    await verifyOriginalForumBackup(journal);
}

async function ensureOriginalOwner(
  journal: ForumReleaseJournal,
): Promise<void> {
  if (!(await Bun.file(LOCK).exists())) {
    if (
      journal.completed.length > 0 ||
      !["prepared", "maintenance", "snapshot", "ready"].includes(journal.phase)
    )
      throw new Error("Forum mutating journal lost its native release lock");
    const handle = await open(LOCK, "wx", 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({
          stage: journal.stage,
          owner: journal.owner,
          startedAt: new Date().toISOString(),
        }),
      );
    } finally {
      await handle.close();
    }
  }
  await beginStormForumBackup(journal.owner);
  await requireOwner(journal);
}

async function prepareOriginalBackup(
  file: string,
  journal: ForumReleaseJournal,
): Promise<void> {
  if (!["prepared", "maintenance", "snapshot"].includes(journal.phase)) return;
  await Bun.sleep(65_000);
  if (!journal.installationObserved) {
    const installation = await observeForumInstallation();
    journal.original =
      installation.state === "installed"
        ? originalForumSource(installation.xenforoVersion)
        : null;
    journal.installationObserved = true;
    journal.phase = "snapshot";
    await writeForumReleaseJournal(file, journal);
  }
  if (journal.original !== null && journal.originalSnapshot === null) {
    const snapshot = await snapshotForum(
      journal.owner,
      {
        cancellationSignal: new AbortController().signal,
        heartbeat: () => {
          /* Foreground operator waits for the original snapshot. */
        },
      },
      journal.original,
    );
    journal.originalSnapshot = snapshot.manifestKey;
  }
  journal.phase = "ready";
  await writeForumReleaseJournal(file, journal);
}

async function repairForumJournal(
  file: string,
  journal: ForumReleaseJournal,
): Promise<void> {
  forumResumeStep(journal);
  if (journal.phase === "complete") {
    await inspectForumJournal(journal);
    return;
  }
  if (journal.phase !== "verified") {
    await ensureOriginalOwner(journal);
    await validateVendorBundle();
    await prepareOriginalBackup(file, journal);
    await verifyOriginalForumBackup(journal);
    await runForumReleaseSteps(
      journal,
      async (step) => {
        await requireOwner(journal);
        await executeForumReleaseStep(step, journal.stage);
      },
      async (value) => {
        await requireOwner(value);
        await writeForumReleaseJournal(file, value);
      },
    );
    await verifyForumRelease(journal);
    journal.phase = "verified";
    await writeForumReleaseJournal(file, journal);
  }
  await requireCleanupOwner(journal);
  await verifyForumRelease(journal);
  if (await Bun.file(MARKER).exists()) await endStormForumBackup(journal.owner);
  if (await Bun.file(LOCK).exists()) await unlink(LOCK);
  journal.phase = "complete";
  await writeForumReleaseJournal(file, journal);
}
