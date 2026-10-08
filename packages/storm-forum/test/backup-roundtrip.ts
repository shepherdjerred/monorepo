import assert from "node:assert/strict";
import { runPhp } from "#src/process.ts";
import {
  beginStormForumBackup,
  endStormForumBackup,
  snapshotForum,
} from "#src/backup.ts";
const owner = "2bcd3a5e-992f-49f4-bb34-901ca3dd32b2";
const previousBundle = "b".repeat(64);
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
