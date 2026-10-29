import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { boundRetentionFixture } from "#automation/retention/lifecycle.test-fixture.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { elapsedQuarantineClient } from "./elapsed-quarantine.test-support.ts";

const harness = automationTestHarness();

test("simulated elapsed quarantine preserves its birth receipt; expired purge needs fresh Network and a new Files invocation", async () => {
  const db = harness.database();
  const bound = await boundRetentionFixture(db, harness.context());
  const f = bound.files;
  try {
    const timing = await elapsedQuarantineClient(db, {
      ...bound.retention.input,
      mediaIds: [f.media.id],
    });
    // Only this actual Files call sees the original-write timestamp interception.
    f.context.db = timing.db;
    try {
      expect(await bound.quarantine()).toEqual({ status: "quarantined" });
    } finally {
      f.context.db = db;
    }
    const birth = await timing.assertCommitted();
    expect(birth.purgeAfter.getTime() - birth.committedAt.getTime()).toBe(
      7 * 86_400_000,
    );
    expect(birth.purgeAfter.getTime()).toBeLessThan(Date.now());
    const decision = await db.retentionDecision.findUniqueOrThrow({
      where: { id: bound.retention.decision.id },
    });
    const entry = RemovalPlanSchema.parse(decision.manifest).assets[0];
    if (entry === undefined)
      throw new Error("Actual quarantine omitted its video manifest");
    const filename = path.join(
      f.context.roots[entry.libraryKind].control,
      "quarantine",
      entry.quarantineId,
    );
    expect(await readFile(filename, "utf8")).toBe(bound.published.content);
    await bound.observe(true);
    expect(await bound.refresh()).toMatchObject({
      status: "purge",
      decisionId: decision.id,
    });
    expect(await timing.assertCommitted()).toEqual(birth);
    const quarantined = await db.libraryAsset.findUniqueOrThrow({
      where: { id: entry.assetId },
    });
    let hashes = 0;
    f.context.checkpoint = (phase) => {
      if (phase === "content-proof-ready") {
        hashes++;
        f.advance(75_000);
      }
      return Promise.resolve();
    };
    expect(
      await createMediaFileActivities(f.context).purgeMediaFiles(
        bound.retention.input,
      ),
    ).toEqual({ status: "protected", reason: "evidence_stale" });
    expect(hashes).toBe(1);
    expect(await readFile(filename, "utf8")).toBe(bound.published.content);
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: entry.assetId } }),
    ).toEqual(quarantined);
    expect(await timing.assertCommitted()).toEqual(birth);

    // The protected invocation has ended; refresh through actual Network producers.
    bound.resetFileClock();
    f.context.checkpoint = (phase) => {
      if (phase === "content-proof-ready") hashes++;
      return Promise.resolve();
    };
    await bound.observe(true);
    expect(await bound.refresh()).toMatchObject({
      status: "purge",
      decisionId: decision.id,
    });
    expect(
      await createMediaFileActivities(f.context).purgeMediaFiles(
        bound.retention.input,
      ),
    ).toEqual({ status: "purged" });
    expect(hashes).toBe(2);
    await expect(readFile(filename)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: entry.assetId } }),
    ).toMatchObject({ state: "purged" });
    expect(await timing.assertCommitted()).toEqual(birth);
  } finally {
    f.context.db = db;
    await rm(f.directory, { recursive: true, force: true });
  }
});
