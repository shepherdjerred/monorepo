import { createHash } from "node:crypto";
import { mkdir, open, rm, unlink } from "node:fs/promises";
import { S3Client } from "bun";
import { Context } from "@temporalio/activity";
import { z } from "zod";
import { StageSchema, forumManifest } from "./config.ts";
import { SnapshotEnvironmentSchema, SnapshotSourceSchema } from "./storage.ts";

const MARKER = "/var/lib/storm-forum/.maintenance";
const OwnerSchema = z.uuid();
const MarkerSchema = z
  .object({ owner: OwnerSchema, startedAt: z.number() })
  .strict();
const BackupEnvironmentSchema = SnapshotEnvironmentSchema.extend({
  STORM_FORUM_STAGE: StageSchema,
});

export async function beginStormForumBackup(owner: string): Promise<void> {
  OwnerSchema.parse(owner);
  if (await Bun.file(MARKER).exists()) {
    const marker = MarkerSchema.parse(await Bun.file(MARKER).json());
    if (marker.owner !== owner) {
      throw new Error("Forum maintenance belongs to a different execution");
    }
    return;
  }
  const handle = await open(MARKER, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify({ owner, startedAt: Date.now() }));
  } finally {
    await handle.close();
  }
}

export async function endStormForumBackup(owner: string): Promise<void> {
  OwnerSchema.parse(owner);
  if (!(await Bun.file(MARKER).exists())) {
    return;
  }
  const marker = MarkerSchema.parse(await Bun.file(MARKER).json());
  if (marker.owner !== owner) {
    throw new Error(
      "Refusing to release another execution's maintenance window",
    );
  }
  await unlink(MARKER);
}

async function digestFile(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

async function backupProcess(
  argv: string[],
  password: string,
  signal: AbortSignal,
  outputPath?: string,
): Promise<void> {
  signal.throwIfAborted();
  const child = Bun.spawn(argv, {
    env: { ...Bun.env, MYSQL_PWD: password },
    timeout: 10 * 60_000,
    stdout: outputPath === undefined ? "ignore" : Bun.file(outputPath),
    stderr: "pipe",
  });
  const abort = () => {
    child.kill();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await new Response(child.stderr).text();
    const code = await child.exited;
    signal.throwIfAborted();
    if (code !== 0) {
      throw new Error(`Forum backup ${argv[0] ?? "process"} failed`);
    }
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function snapshotStormForum(
  owner: string,
): Promise<{ manifestKey: string }> {
  const context = Context.current();
  context.cancellationSignal.throwIfAborted();
  const timer = setInterval(() => {
    context.heartbeat("forum snapshot in progress");
  }, 30_000);
  try {
    return await snapshotForum(owner, context);
  } finally {
    clearInterval(timer);
  }
}

export async function snapshotForum(
  owner: string,
  context: Pick<Context, "heartbeat" | "cancellationSignal">,
  sourceRelease?: z.infer<typeof SnapshotSourceSchema>,
): Promise<{ manifestKey: string }> {
  OwnerSchema.parse(owner);
  const env = BackupEnvironmentSchema.parse(Bun.env);
  const source = SnapshotSourceSchema.parse(
    sourceRelease ?? {
      bundleSha256: env.BUNDLE_SHA256,
      xenforoVersion: forumManifest.xenforoVersion,
      runtimeImage: env.RUNTIME_IMAGE,
    },
  );
  const marker = MarkerSchema.parse(await Bun.file(MARKER).json());
  if (marker.owner !== owner) {
    throw new Error("Snapshot requires this execution's maintenance window");
  }
  const client = new S3Client({
    endpoint: env.BACKUP_ENDPOINT,
    bucket: env.BACKUP_BUCKET,
    accessKeyId: env.BACKUP_ACCESS_KEY,
    secretAccessKey: env.BACKUP_SECRET_KEY,
    region: "us-east-1",
  });
  const prefix = `snapshots/${env.STORM_FORUM_STAGE}/${owner}`;
  const manifestKey = `${prefix}/manifest.json`;
  if (await client.file(manifestKey).exists()) {
    const committedSource = SnapshotSourceSchema.parse(
      await client.file(`${prefix}/source-release.json`).json(),
    );
    if (JSON.stringify(committedSource) !== JSON.stringify(source)) {
      throw new Error(
        "Committed snapshot belongs to a different source release",
      );
    }
    return { manifestKey };
  }
  const temporary = `/var/lib/storm-forum/.backup/${owner}`;
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  try {
    context.heartbeat("database export");
    const database = `${temporary}/database.sql`;
    await backupProcess(
      [
        "mariadb-dump",
        "--host",
        env.DB_HOST,
        "--user",
        env.DB_USER,
        "--single-transaction",
        "--skip-lock-tables",
        "--hex-blob",
        env.DB_NAME,
      ],
      env.DB_PASSWORD,
      context.cancellationSignal,
      database,
    );
    context.heartbeat("attachment archive");
    const files = `${temporary}/files.tar.gz`;
    await backupProcess(
      [
        "tar",
        "-czf",
        files,
        "-C",
        "/var/lib/storm-forum",
        "data",
        "internal_data",
      ],
      env.DB_PASSWORD,
      context.cancellationSignal,
    );
    const payloads = [];
    for (const [name, path] of [
      ["database.sql", database],
      ["files.tar.gz", files],
    ] as const) {
      context.cancellationSignal.throwIfAborted();
      context.heartbeat(`upload ${name}`);
      const hash = await digestFile(path);
      const key = `${prefix}/${name}`;
      await client.file(key).write(Bun.file(path));
      payloads.push({ key, sha256: hash, bytes: Bun.file(path).size });
    }
    // The manifest commits the pair. An interrupted upload has no restoreable snapshot.
    context.cancellationSignal.throwIfAborted();
    // Keep the v1 manifest readable by the previous runtime during rollback.
    // New runtimes require this source record before restoring the pair.
    await client
      .file(`${prefix}/source-release.json`)
      .write(JSON.stringify(source));
    context.cancellationSignal.throwIfAborted();
    await client.file(manifestKey).write(
      JSON.stringify({
        schemaVersion: 1,
        stage: env.STORM_FORUM_STAGE,
        owner,
        xenforoVersion: source.xenforoVersion,
        bundleSha256: source.bundleSha256,
        createdAt: new Date().toISOString(),
        payloads,
      }),
    );
    return { manifestKey };
  } finally {
    // The exact directory is derived from a validated UUID, never an unresolved path.
    await rm(temporary, { recursive: true, force: true });
  }
}
