import assert from "node:assert/strict";
import { releaseForum } from "#src/release.ts";
import { beginStormForumBackup, endStormForumBackup } from "#src/backup.ts";
import { forumManifest } from "#src/config.ts";
import { rename } from "node:fs/promises";

const owner = crypto.randomUUID();
const dependency = forumManifest.vendorDependencies[0];
if (dependency === undefined)
  throw new Error("Preflight fixture requires a reviewed vendor dependency");
const source = `/app/forum/${dependency.path}`;
const withheld = `${source}.preflight-${owner}`;
// The licensed integration input is complete. Withhold one exact dependency
// inside this disposable container so the preflight failure is intentional.
await rename(source, withheld);
try {
  await beginStormForumBackup(owner);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      Bun.env["FORUM_RELEASE_ID"] = crypto.randomUUID().replaceAll("-", "");
      Bun.env["RUNTIME_IMAGE"] =
        `docker.io/shepherdjerred/storm-forum@sha256:${"a".repeat(64)}`;
      Bun.env["BUNDLE_SHA256"] = "a".repeat(64);
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
} finally {
  await rename(withheld, source);
}
process.stdout.write(
  "Failed release preflight is retryable and preserves another backup's maintenance marker.\n",
);
