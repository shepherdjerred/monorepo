import assert from "node:assert/strict";
import { S3Client } from "bun";
import { runPhp } from "#src/process.ts";
import {
  beginStormForumBackup,
  endStormForumBackup,
  snapshotForum,
} from "#src/backup.ts";
import { SnapshotEnvironmentSchema } from "#src/storage.ts";
import { SnapshotSchema, validateSnapshot } from "#src/restore.ts";
import { forumManifest } from "#src/config.ts";
const storage = SnapshotEnvironmentSchema.parse(Bun.env);
const client = new S3Client({
  endpoint: storage.BACKUP_ENDPOINT,
  bucket: storage.BACKUP_BUCKET,
  accessKeyId: storage.BACKUP_ACCESS_KEY,
  secretAccessKey: storage.BACKUP_SECRET_KEY,
  region: "us-east-1",
});
const owner = "2bcd3a5e-992f-49f4-bb34-901ca3dd32b2";
const previousBundle = {
  bundleSha256: "b".repeat(64),
  xenforoVersion: forumManifest.xenforoVersion,
};
// Emulate the unsafe production settings that recovery must replace.
await runPhp(["cmd.php", "storm:configure", "--stage", "prod"]);
await runPhp([
  "cmd.php",
  "storm:policy",
  "--registration",
  "enabled",
  "--season",
  "normal",
]);
const other = "e7a45671-bb02-4e36-8a55-74519c4fc2cc";
const phases: unknown[] = [];
const heartbeat = (detail: unknown) => {
  phases.push(detail);
};
await Bun.write(
  "/var/lib/storm-forum/data/restore-sentinel.txt",
  "storm-owned-attachment\n",
);
await Bun.write(
  "/var/lib/storm-forum/internal_data/restore-sentinel.txt",
  "storm-private-attachment\n",
);
await beginStormForumBackup(owner);
try {
  await assert.rejects(beginStormForumBackup(other), /different execution/);
  await assert.rejects(endStormForumBackup(other), /another execution/);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    snapshotForum(owner, { cancellationSignal: cancelled.signal, heartbeat }),
  );
  const result = await snapshotForum(
    owner,
    {
      cancellationSignal: new AbortController().signal,
      heartbeat,
    },
    previousBundle,
  );
  assert.deepEqual(
    await snapshotForum(
      owner,
      {
        cancellationSignal: new AbortController().signal,
        heartbeat,
      },
      previousBundle,
    ),
    result,
  );
  assert.ok(
    phases.includes("database export") &&
      phases.includes("upload files.tar.gz"),
  );
  process.stdout.write(result.manifestKey + "\n");
} finally {
  await endStormForumBackup(owner);
}
await beginStormForumBackup(other);
try {
  // A future XF upgrade must describe the source version, even though the
  // snapshot worker runs the incoming image. A mismatched restore must fail.
  const old = await snapshotForum(
    other,
    {
      cancellationSignal: new AbortController().signal,
      heartbeat,
    },
    { bundleSha256: previousBundle.bundleSha256, xenforoVersion: "2.3.8" },
  );
  const manifest = SnapshotSchema.parse(
    await client.file(old.manifestKey).json(),
  );
  assert.equal(manifest.xenforoVersion, "2.3.8");
  assert.equal(manifest.bundleSha256, previousBundle.bundleSha256);
  assert.throws(
    () =>
      validateSnapshot(manifest, old.manifestKey, previousBundle.bundleSha256),
    /installed release/,
  );
} finally {
  await endStormForumBackup(other);
}
