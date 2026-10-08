import { createHash } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { S3Client } from "bun";
import { z } from "zod";
import { forumManifest, type Stage } from "./config.ts";
import { runPhp } from "./process.ts";
import {
  beginStormForumBackup,
  endStormForumBackup,
  snapshotForum,
} from "./backup.ts";
import { SnapshotSourceSchema } from "./storage.ts";

const BundleEnvironmentSchema = z.object({
  BUNDLE_ENDPOINT: z.url(),
  BUNDLE_BUCKET: z.string().min(1),
  BUNDLE_ACCESS_KEY: z.string().min(1),
  BUNDLE_SECRET_KEY: z.string().min(1),
  BUNDLE_KEY: z.string().regex(/^releases\/[\w.-]+\.zip$/),
  BUNDLE_SHA256: z.string().regex(/^[a-f0-9]{64}$/),
});
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
  const lock = "/var/lib/storm-forum/.release-lock";
  const handle = await open(lock, "wx", 0o600);
  const owner = crypto.randomUUID();
  let completed = false;
  let ownsMaintenance = false;
  let mutating = false;
  let unsafeInstallation = false;
  try {
    await handle.writeFile(
      JSON.stringify({ stage, owner, startedAt: new Date().toISOString() }),
    );
    await validateVendorBundle();
    await beginStormForumBackup(owner);
    ownsMaintenance = true;
    await Bun.sleep(65_000);
    unsafeInstallation = true;
    const installationOutput = await runPhp(
      ["/opt/storm-forum/runtime/installed.php"],
      "/app/forum",
    );
    const installation = z
      .enum(["installed", "empty"])
      .parse(installationOutput.trim());
    unsafeInstallation = false;
    if (installation === "installed") {
      // The database has not been upgraded yet. Restore it with the previous
      // private bundle, rather than recording this job's incoming bundle.
      const sourceBundle = SnapshotSourceSchema.parse({
        bundleSha256: Bun.env["BACKUP_SOURCE_BUNDLE_SHA256"],
        xenforoVersion: Bun.env["BACKUP_SOURCE_XENFORO_VERSION"],
        runtimeImage: Bun.env["BACKUP_SOURCE_RUNTIME_IMAGE"],
      });
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
      process.stdout.write(`Pre-upgrade snapshot: ${snapshot.manifestKey}\n`);
    }
    mutating = true;
    await runPhp(
      ["/opt/storm-forum/runtime/install.php"],
      "/app/forum",
      15 * 60_000,
    );
    await runPhp(
      ["/opt/storm-forum/runtime/addons.php"],
      "/app/forum",
      15 * 60_000,
    );
    await runPhp(["cmd.php", "storm:configure", "--stage", stage]);
    await runPhp(["cmd.php", "storm:styles"], "/app/forum", 5 * 60_000);
    // ACP merges are resumable manual jobs. Finish them before the importer
    // checks its ownership fence; an unfinished merge still blocks import.
    await runPhp([
      "cmd.php",
      "xf:run-jobs",
      "--manual-only",
      "--max-execution-time",
      "50",
    ]);
    await runPhp(["cmd.php", "storm:seed"]);
    await runPhp(["cmd.php", "storm:history"], "/app/forum", 5 * 60_000);
    await runPhp(
      ["cmd.php", "storm:accounts", "--stage", stage],
      "/app/forum",
      5 * 60_000,
    );
    await runPhp(["cmd.php", "xf:run-jobs", "--max-execution-time", "50"]);
    completed = true;
  } finally {
    await handle.close();
    // A failed migration requires inspection before another release can run.
    if (completed || (!mutating && !unsafeInstallation)) {
      if (ownsMaintenance) {
        await endStormForumBackup(owner);
      }
      await unlink(lock);
    }
  }
}
