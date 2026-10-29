import assert from "node:assert/strict";
import { releaseForum } from "#src/release.ts";
import {
  MAINTENANCE_MARKER,
  beginForumMaintenance,
  endForumMaintenance,
} from "#src/maintenance.ts";
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
  await beginForumMaintenance(owner);
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
      const marker = await Bun.file(MAINTENANCE_MARKER).text();
      assert.ok(marker.includes(owner));
    }
  } finally {
    await endForumMaintenance(owner);
  }
} finally {
  await rename(withheld, source);
}
process.stdout.write(
  "Failed release preflight is retryable and preserves another execution's maintenance marker.\n",
);
