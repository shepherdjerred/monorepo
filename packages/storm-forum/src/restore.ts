import { createHash } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { S3Client } from "bun";
import { z } from "zod";
import { forumManifest } from "./config.ts";
import { beginStormForumBackup, endStormForumBackup } from "./backup.ts";
import { SnapshotEnvironmentSchema } from "./storage.ts";
import { runPhp } from "./process.ts";

export const SnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    stage: z.enum(["beta", "prod"]),
    owner: z.uuid(),
    xenforoVersion: z.string(),
    bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.iso.datetime(),
    payloads: z
      .array(
        z
          .object({
            key: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z.number().int().positive(),
          })
          .strict(),
      )
      .length(2),
  })
  .strict();
export function validateSnapshot(
  value: unknown,
  manifestKey: string,
  bundleSha256: string,
) {
  const snapshot = SnapshotSchema.parse(value);
  const prefix = `snapshots/${snapshot.stage}/${snapshot.owner}`;
  if (
    manifestKey !== `${prefix}/manifest.json` ||
    snapshot.bundleSha256 !== bundleSha256 ||
    snapshot.xenforoVersion !== forumManifest.xenforoVersion
  ) {
    throw new Error("Snapshot does not match its key and installed release");
  }
  if (
    snapshot.payloads
      .map((payload) => payload.key)
      .sort()
      .join("|") !==
    [`${prefix}/database.sql`, `${prefix}/files.tar.gz`].join("|")
  ) {
    throw new Error(
      "Snapshot must contain exactly the database and files pair",
    );
  }
  return snapshot;
}

const EnvironmentSchema = SnapshotEnvironmentSchema.extend({
  STORM_FORUM_STAGE: z.literal("beta"),
  RESTORE_MANIFEST_KEY: z
    .string()
    .regex(/^snapshots\/(?:beta|prod)\/[a-f0-9-]+\/manifest\.json$/),
});

export async function restoreForum(): Promise<void> {
  // Recovery always targets an empty, private beta installation. Promotion back
  // to production is an explicit release decision after acceptance.
  const env = EnvironmentSchema.parse(Bun.env);
  const owner = crypto.randomUUID();
  const temporary = `/var/lib/storm-forum/.restore/${owner}`;
  await beginStormForumBackup(owner);
  let completed = false;
  try {
    await mkdir(temporary, { recursive: true, mode: 0o700 });
    const client = new S3Client({
      endpoint: env.BACKUP_ENDPOINT,
      bucket: env.BACKUP_BUCKET,
      accessKeyId: env.BACKUP_ACCESS_KEY,
      secretAccessKey: env.BACKUP_SECRET_KEY,
      region: "us-east-1",
    });
    const snapshot = validateSnapshot(
      await client.file(env.RESTORE_MANIFEST_KEY).json(),
      env.RESTORE_MANIFEST_KEY,
      env.BUNDLE_SHA256,
    );
    for (const payload of snapshot.payloads) {
      const name = payload.key.endsWith("/database.sql")
        ? "database.sql"
        : "files.tar.gz";
      const destination = `${temporary}/${name}`;
      await Bun.write(destination, client.file(payload.key));
      const digest = createHash("sha256");
      for await (const chunk of Bun.file(destination).stream()) {
        digest.update(chunk);
      }
      if (
        Bun.file(destination).size !== payload.bytes ||
        digest.digest("hex") !== payload.sha256
      ) {
        throw new Error("Restore payload checksum mismatch");
      }
    }
    const db = [
      "mariadb",
      "--host",
      env.DB_HOST,
      "--user",
      env.DB_USER,
      "--batch",
      "--skip-column-names",
      env.DB_NAME,
    ];
    const command = async (
      argv: string[],
      input?: ReturnType<typeof Bun.file>,
    ) => {
      const child = Bun.spawn(argv, {
        env: { ...Bun.env, MYSQL_PWD: env.DB_PASSWORD },
        stdin: input ?? "ignore",
        stdout: "pipe",
        stderr: "ignore",
        timeout: 10 * 60_000,
      });
      const output = await new Response(child.stdout).text();
      if ((await child.exited) !== 0) {
        throw new Error(`Restore ${argv[0] ?? "process"} failed`);
      }
      return output;
    };
    const tables = await command([...db, "--execute", "SHOW TABLES"]);
    if (tables.trim() !== "") {
      throw new Error("Restore requires an empty target database");
    }
    for (const directory of ["data", "internal_data"]) {
      const entries = await readdir(`/var/lib/storm-forum/${directory}`);
      if (
        entries.some((entry) => entry !== ".htaccess" && entry !== "index.html")
      ) {
        throw new Error("Restore requires empty target attachment directories");
      }
    }
    const listing = await command(["tar", "-tzf", `${temporary}/files.tar.gz`]);
    if (
      listing
        .split("\n")
        .filter(Boolean)
        .some(
          (entry) =>
            !/^(?:data|internal_data)(?:\/|$)/.test(entry) ||
            entry.split("/").includes(".."),
        )
    ) {
      throw new Error("Unsafe attachment archive path");
    }
    const details = await command([
      "tar",
      "-tvzf",
      `${temporary}/files.tar.gz`,
    ]);
    if (
      details
        .split("\n")
        .filter(Boolean)
        .some((entry) => !["-", "d"].includes(entry[0] ?? ""))
    ) {
      throw new Error("Attachment archive contains links or special files");
    }
    await command(db, Bun.file(`${temporary}/database.sql`));
    await command([
      "tar",
      "-xzf",
      `${temporary}/files.tar.gz`,
      "--no-same-owner",
      "-C",
      "/var/lib/storm-forum",
    ]);
    await runPhp(["cmd.php", "storm:configure", "--stage", "beta"]);
    await runPhp([
      "cmd.php",
      "storm:policy",
      "--registration",
      "disabled",
      "--season",
      "normal",
    ]);
    await runPhp(["cmd.php", "xf:run-jobs", "--max-execution-time", "50"]);
    completed = true;
  } finally {
    await rm(temporary, { recursive: true, force: true });
    // A partial restore remains unavailable until an operator inspects it.
    if (completed) {
      await endStormForumBackup(owner);
    }
  }
}
