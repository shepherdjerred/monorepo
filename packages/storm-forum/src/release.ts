import { createHash } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { S3Client } from "bun";
import { z } from "zod";
import { ForumReleaseIdSchema } from "@shepherdjerred/ops-model/forum-recovery.ts";
import { forumManifest, type Stage } from "./config.ts";
import { runPhp } from "./process.ts";
import {
  beginStormForumBackup,
  endStormForumBackup,
  snapshotForum,
} from "./backup.ts";
import { SnapshotSourceSchema } from "./storage.ts";
import {
  ForumReleaseJournalSchema,
  reuseCompletedForumRelease,
  runForumReleaseSteps,
  writeForumReleaseJournal,
  type ForumReleaseJournal,
  type FORUM_RELEASE_STEPS,
} from "./release-journal.ts";

const BundleEnvironmentSchema = z.object({
  BUNDLE_ENDPOINT: z.url(),
  BUNDLE_BUCKET: z.string().min(1),
  BUNDLE_ACCESS_KEY: z.string().min(1),
  BUNDLE_SECRET_KEY: z.string().min(1),
  BUNDLE_KEY: z.string().regex(/^releases\/[\w.-]+\.zip$/),
  BUNDLE_SHA256: z.string().regex(/^[a-f0-9]{64}$/),
});
const InstallationSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("installed"),
      xenforoVersion: z.string().min(1),
    })
    .strict(),
  z.object({ state: z.literal("empty") }).strict(),
]);
export async function observeForumInstallation() {
  return InstallationSchema.parse(
    JSON.parse(await runPhp(["/opt/storm-forum/runtime/installed.php"])),
  );
}
export function originalForumSource(installedVersion: string) {
  return validateBackupSource(
    {
      bundleSha256: Bun.env["BACKUP_SOURCE_BUNDLE_SHA256"],
      xenforoVersion: Bun.env["BACKUP_SOURCE_XENFORO_VERSION"],
      runtimeImage: Bun.env["BACKUP_SOURCE_RUNTIME_IMAGE"],
    },
    installedVersion,
  );
}
export function validateBackupSource(
  source: unknown,
  installedVersion: string,
) {
  const release = SnapshotSourceSchema.parse(source);
  if (release.xenforoVersion !== installedVersion) {
    throw new Error(
      "Backup source XenForo version differs from the installed database",
    );
  }
  return release;
}
export async function assembleBundle(): Promise<void> {
  const env = BundleEnvironmentSchema.parse(Bun.env);
  const client = new S3Client({
    endpoint: env.BUNDLE_ENDPOINT,
    bucket: env.BUNDLE_BUCKET,
    accessKeyId: env.BUNDLE_ACCESS_KEY,
    secretAccessKey: env.BUNDLE_SECRET_KEY,
    region: "us-east-1",
  });
  await mkdir("/tmp/storm-forum", { recursive: true });
  const path = "/tmp/storm-forum/private-release.zip";
  try {
    const systemCa = await Bun.file(
      "/etc/ssl/certs/ca-certificates.crt",
    ).text();
    const postalCa = await Bun.file("/etc/postal/ca.crt").text();
    await Bun.write(
      "/tmp/storm-forum/ca-bundle.crt",
      `${systemCa}\n${postalCa}\n`,
    );
    await Bun.write(path, client.file(env.BUNDLE_KEY));
    const digest = createHash("sha256");
    for await (const chunk of Bun.file(path).stream()) {
      digest.update(chunk);
    }
    if (digest.digest("hex") !== env.BUNDLE_SHA256) {
      throw new Error("Private bundle checksum mismatch");
    }
    await runPhp(
      ["/opt/storm-forum/runtime/assemble.php", path, env.BUNDLE_SHA256],
      "/opt/storm-forum",
    );
  } finally {
    if (await Bun.file(path).exists()) {
      await unlink(path);
    }
  }
}
export async function validateVendorBundle(): Promise<void> {
  const missing: string[] = [];
  for (const dependency of forumManifest.vendorDependencies) {
    const file = Bun.file(`/app/forum/${dependency.path}`);
    if (!(await file.exists())) {
      missing.push(`${dependency.key} ${dependency.version}`);
      continue;
    }
    if (dependency.kind === "addon") {
      const metadata = z
        .object({ version_string: z.string() })
        .parse(await file.json());
      validateVendorVersion(
        dependency.key,
        metadata.version_string,
        dependency.version,
      );
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Private release dependencies missing: ${missing.join(", ")}`,
    );
  }
  await runPhp(["/opt/storm-forum/runtime/style-preflight.php"], "/app/forum");
}
export function validateVendorVersion(
  key: string,
  version: string,
  requirement: string,
): void {
  if (!requirement.startsWith(">=")) {
    if (version !== requirement) {
      throw new Error(`Vendor version does not match the manifest: ${key}`);
    }
    return;
  }
  const minimum = requirement.slice(2).split(".").map(Number);
  const current = version.split(".").map(Number);
  if (
    current.length !== minimum.length ||
    current.some((value) => Number.isNaN(value))
  ) {
    throw new Error(`Invalid vendor version: ${key}`);
  }
  for (const [index, part] of minimum.entries()) {
    const actual = current[index];
    if (actual === undefined || actual < part) {
      throw new Error(`Vendor version below minimum: ${key}`);
    }
    if (actual > part) {
      return;
    }
  }
}
export async function releaseForum(stage: Stage): Promise<void> {
  if ((Bun.env["FORUM_RECOVERY_INTENT_ID"] ?? "").length > 0)
    throw new Error(
      "Forum recovery requires the dedicated native recovery entrypoint",
    );
  const candidate = SnapshotSourceSchema.parse({
    runtimeImage: Bun.env["RUNTIME_IMAGE"],
    bundleSha256: Bun.env["BUNDLE_SHA256"],
    xenforoVersion: forumManifest.xenforoVersion,
  });
  const releaseId = ForumReleaseIdSchema.parse(Bun.env["FORUM_RELEASE_ID"]);
  const journalPath = `/var/lib/storm-forum/.release-journals/${releaseId}.json`;
  const lock = "/var/lib/storm-forum/.release-lock";
  if (await Bun.file(journalPath).exists()) {
    const prior = ForumReleaseJournalSchema.parse(
      await Bun.file(journalPath).json(),
    );
    if (
      await reuseCompletedForumRelease(
        { journal: prior, candidate, stage },
        {
          unlocked: async () =>
            !(await Bun.file(lock).exists()) &&
            !(await Bun.file("/var/lib/storm-forum/.maintenance").exists()),
          verify: async () => {
            await verifyForumRelease(prior);
          },
        },
      )
    )
      return;
  }
  const handle = await open(lock, "wx", 0o600);
  const owner = crypto.randomUUID();
  let completed = false;
  let ownsMaintenance = false;
  let mutating = false;
  let unsafeInstallation = false;
  const journal: ForumReleaseJournal = {
    schema: "storm-forum-release/v1",
    stage,
    owner,
    candidate,
    original: null,
    installationObserved: false,
    originalSnapshot: null,
    phase: "prepared",
    step: null,
    completed: [],
  };
  const checkpoint = async () => {
    await writeForumReleaseJournal(journalPath, journal);
  };
  try {
    await handle.writeFile(
      JSON.stringify({ stage, owner, startedAt: new Date().toISOString() }),
    );
    await mkdir("/var/lib/storm-forum/.release-journals", {
      recursive: true,
      mode: 0o700,
    });
    await checkpoint();
    await validateVendorBundle();
    journal.phase = "maintenance";
    await checkpoint();
    await beginStormForumBackup(owner);
    ownsMaintenance = true;
    await Bun.sleep(65_000);
    unsafeInstallation = true;
    const installation = await observeForumInstallation();
    unsafeInstallation = false;
    if (installation.state === "installed") {
      // The database has not been upgraded yet. Restore it with the previous
      // private bundle, rather than recording this job's incoming bundle.
      const sourceBundle = originalForumSource(installation.xenforoVersion);
      journal.original = sourceBundle;
      journal.installationObserved = true;
      journal.phase = "snapshot";
      await checkpoint();
      const snapshot = await snapshotForum(
        owner,
        {
          cancellationSignal: new AbortController().signal,
          heartbeat: (message) => {
            process.stdout.write(`${String(message)}\n`);
          },
        },
        sourceBundle,
      );
      journal.originalSnapshot = snapshot.manifestKey;
      await checkpoint();
      process.stdout.write(`Pre-upgrade snapshot: ${snapshot.manifestKey}\n`);
    }
    journal.installationObserved = true;
    journal.phase = "ready";
    await checkpoint();
    mutating = true;
    await runForumReleaseSteps(
      journal,
      (step) => executeForumReleaseStep(step, stage),
      checkpoint,
    );
    await verifyForumRelease(journal);
    journal.phase = "verified";
    await checkpoint();
    completed = true;
  } finally {
    await handle.close();
    // A failed migration requires inspection before another release can run.
    if (completed || (!mutating && !unsafeInstallation)) {
      if (ownsMaintenance) {
        await endStormForumBackup(owner);
      }
      await unlink(lock);
      if (completed) {
        journal.phase = "complete";
        await checkpoint();
      }
    }
  }
}

export async function executeForumReleaseStep(
  step: (typeof FORUM_RELEASE_STEPS)[number],
  stage: Stage,
): Promise<void> {
  const commands = {
    install: ["/opt/storm-forum/runtime/install.php"],
    addons: ["/opt/storm-forum/runtime/addons.php"],
    configure: ["cmd.php", "storm:configure", "--stage", stage],
    styles: ["cmd.php", "storm:styles"],
    "manual-jobs": [
      "cmd.php",
      "xf:run-jobs",
      "--manual-only",
      "--max-execution-time",
      "50",
    ],
    seed: ["cmd.php", "storm:seed"],
    history: ["cmd.php", "storm:history", "--migrate"],
    accounts: ["cmd.php", "storm:accounts", "--stage", stage],
    jobs: ["cmd.php", "xf:run-jobs", "--max-execution-time", "50"],
  };
  await runPhp(
    commands[step],
    "/app/forum",
    ["install", "addons"].includes(step) ? 15 * 60_000 : 5 * 60_000,
  );
}

export async function verifyForumRelease(
  journal: ForumReleaseJournal,
): Promise<void> {
  ForumReleaseJournalSchema.parse(journal);
  const assembly = await Bun.file("/app/forum/.storm-assembly").text();
  const installed = InstallationSchema.parse(
    JSON.parse(await runPhp(["/opt/storm-forum/runtime/installed.php"])),
  );
  if (
    installed.state !== "installed" ||
    installed.xenforoVersion !== journal.candidate.xenforoVersion ||
    assembly.trim() !== journal.candidate.bundleSha256
  )
    throw new Error(
      "Forum native installed identity differs from the same approved recovery candidate",
    );
  await runPhp(["/opt/storm-forum/runtime/recovery-verify.php"]);
}
