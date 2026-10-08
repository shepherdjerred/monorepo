import assert from "node:assert/strict";
import { rename, unlink } from "node:fs/promises";
import { releaseForum } from "#src/release.ts";
import { endStormForumBackup } from "#src/backup.ts";
import { z } from "zod";
const OwnerSchema = z.object({ owner: z.uuid() });

// Only the disposable licensed fixture runs this test. Keep the database intact
// while emulating a missing native installation marker.
const nativeLock = "/var/lib/storm-forum/internal_data/install-lock.php";
const heldLock = `${nativeLock}.fixture`;
assert.equal(await Bun.file(heldLock).exists(), false);
assert.equal(
  await Bun.file("/var/lib/storm-forum/.maintenance").exists(),
  false,
);
assert.equal(
  await Bun.file("/var/lib/storm-forum/.release-lock").exists(),
  false,
);
await rename(nativeLock, heldLock);
try {
  await assert.rejects(releaseForum("beta"), /installed.php.*failed/);
  assert.equal(
    await Bun.file("/var/lib/storm-forum/.release-lock").exists(),
    true,
  );
  const lock = OwnerSchema.parse(
    await Bun.file("/var/lib/storm-forum/.release-lock").json(),
  );
  const marker = OwnerSchema.parse(
    await Bun.file("/var/lib/storm-forum/.maintenance").json(),
  );
  assert.equal(marker.owner, lock.owner);
  await assert.rejects(releaseForum("beta"), /EEXIST/);
} finally {
  await rename(heldLock, nativeLock);
  const lock = OwnerSchema.parse(
    await Bun.file("/var/lib/storm-forum/.release-lock").json(),
  );
  await endStormForumBackup(lock.owner);
  await unlink("/var/lib/storm-forum/.release-lock");
}
process.stdout.write(
  "Incomplete native installation retains its maintenance and release fences; automatic retry is blocked.\n",
);
