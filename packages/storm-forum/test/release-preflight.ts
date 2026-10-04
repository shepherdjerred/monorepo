import assert from "node:assert/strict";
import { releaseForum } from "#src/release.ts";
import { beginStormForumBackup, endStormForumBackup } from "#src/backup.ts";

const owner = crypto.randomUUID();
await beginStormForumBackup(owner);
try {
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(
      releaseForum("beta"),
      /Private release dependencies missing/,
    );
    assert.equal(
      await Bun.file("/var/lib/storm-forum/.release-lock").exists(),
      false,
    );
    const marker = await Bun.file("/var/lib/storm-forum/.maintenance").text();
    assert.ok(marker.includes(owner));
  }
} finally {
  await endStormForumBackup(owner);
}
process.stdout.write(
  "Failed release preflight is retryable and preserves another backup's maintenance marker.\n",
);
