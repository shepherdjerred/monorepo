import assert from "node:assert/strict";
import { rename, unlink } from "node:fs/promises";
import { releaseForum, validateBackupSource } from "#src/release.ts";
import { endStormForumBackup } from "#src/backup.ts";
import { z } from "zod";
import { runPhp } from "#src/process.ts";
import { forumManifest } from "#src/config.ts";
const OwnerSchema = z.object({ owner: z.uuid() });
const installed = z
  .object({ state: z.literal("installed"), xenforoVersion: z.string().min(1) })
  .strict()
  .parse(JSON.parse(await runPhp(["/opt/storm-forum/runtime/installed.php"])));
assert.equal(installed.xenforoVersion, forumManifest.xenforoVersion);
assert.throws(
  () =>
    validateBackupSource(
      {
        xenforoVersion: "2.3.8",
        bundleSha256: "a".repeat(64),
        runtimeImage: `ghcr.io/shepherdjerred/storm-forum@sha256:${"a".repeat(64)}`,
      },
      installed.xenforoVersion,
    ),
  /differs from the installed database/,
);

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
let tableHeld = false;
try {
  // Preserve the table under a fixture-only name, leaving other native tables
  // in place. A partial installation need not contain xf_user yet.
  await runPhp([
    "-r",
    String.raw`require '/app/forum/src/XF.php'; XF::start('/app/forum');
    $app = XF::setupApp('XF\Install\App'); $app->start();
    if ($app->db()->fetchOne("SHOW TABLES LIKE 'storm_fixture_user'")) { throw new RuntimeException('Fixture table already exists'); }
    $app->db()->query('RENAME TABLE xf_user TO storm_fixture_user');`,
  ]);
  tableHeld = true;
  await assert.rejects(
    runPhp(["/opt/storm-forum/runtime/install.php"]),
    /install.php.*failed/,
  );
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
  if (tableHeld) {
    await runPhp([
      "-r",
      String.raw`require '/app/forum/src/XF.php'; XF::start('/app/forum');
      $app = XF::setupApp('XF\Install\App'); $app->start();
      $app->db()->query('RENAME TABLE storm_fixture_user TO xf_user');`,
    ]);
  }
  await rename(heldLock, nativeLock);
  const lock = OwnerSchema.parse(
    await Bun.file("/var/lib/storm-forum/.release-lock").json(),
  );
  await endStormForumBackup(lock.owner);
  await unlink("/var/lib/storm-forum/.release-lock");
}
process.stdout.write(
  "Partial native installation without xf_user retains its maintenance and release fences; install and automatic retry are blocked.\n",
);
