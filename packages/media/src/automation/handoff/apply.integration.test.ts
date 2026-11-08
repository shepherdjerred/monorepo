import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { afterAll, beforeAll, expect, test } from "vitest";
import { rm, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { prepareHandoffFiles } from "./files.ts";
import { applyPreparedHandoff } from "./apply.ts";
import { handoffFixture } from "./test-fixture.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const value = await handoffFixture(cluster.database);
  directories.push(value.directory);
  return value;
}

test("real owner prepare/proof/apply adopts only selected bytes at the restored epoch and retains household hold", async () => {
  const f = await fixture();
  const db = cluster.database;
  const ready = await f.ready();
  const receiptId = await applyPreparedHandoff(
    f.context,
    ready.input,
    ready.prepared,
  );
  expect(
    await applyPreparedHandoff(f.context, ready.input, ready.prepared),
  ).toBe(receiptId);
  expect(await readFile(f.target, "utf8")).toBe(f.bytes);
  const asset = await db.libraryAsset.findUniqueOrThrow({
    where: { path: f.target },
  });
  expect(asset).toMatchObject({
    owned: true,
    ownershipEpoch: 0,
    state: "published",
  });
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.network.media.id)),
    }),
  ).toMatchObject({ automationEpoch: 0 });
  expect(
    await db.recoveryHold.findUniqueOrThrow({
      where: targetWhere(defaultScope(f.network.media.id)),
    }),
  ).toMatchObject({
    releasedAt: null,
    reason: "recovery_request_history_unconfirmed",
  });
  expect(
    await db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toMatchObject({ mode: "active", recoveryEpoch: 0, version: 1 });
  expect(
    await db.mediaStorageAuthority.findUniqueOrThrow({
      where: { rootPath: f.context.files.roots.movies.library },
    }),
  ).toMatchObject({ workerPodUid: "files-pod-uid" });
  expect(
    await db.mediaHandoffReceipt.count({ where: { planId: f.planId } }),
  ).toBe(1);
});

test("content mutation after owner review protects without granting any selected asset", async () => {
  const f = await fixture();
  const ready = await f.ready();
  await writeFile(f.target, "Changed immutable media!!");
  await expect(
    applyPreparedHandoff(f.context, ready.input, ready.prepared),
  ).rejects.toThrow();
  expect(
    await cluster.database.libraryAsset.findUnique({
      where: { path: f.target },
    }),
  ).toBeNull();
});

test.each(["file", "ancestor"] as const)(
  "identical-byte %s replacement after owner review rejects newly generated apply proof",
  async (replacement) => {
    const f = await fixture();
    const ready = await f.ready();
    const reviewed = ready.prepared.evidence.files[0];
    if (reviewed === undefined)
      throw new Error("Reviewed file fixture missing");
    if (replacement === "file") {
      const next = `${f.target}.replacement`;
      await writeFile(next, f.bytes);
      await rename(next, f.target);
    } else {
      const directory = path.dirname(f.target);
      await rename(directory, `${directory}-previous`);
      await mkdir(directory);
      await writeFile(f.target, f.bytes);
    }
    const regenerated = await prepareHandoffFiles(f.context, f.planId);
    const current = regenerated.evidence.files[0];
    if (current === undefined)
      throw new Error("Regenerated file fixture missing");
    expect(current.checksum).toBe(reviewed.checksum);
    expect(current.sizeBytes).toBe(reviewed.sizeBytes);
    expect(current.identity.inode).not.toBe(reviewed.identity.inode);
    if (replacement === "ancestor")
      expect(current.identity.ancestors).not.toEqual(
        reviewed.identity.ancestors,
      );
    await expect(
      applyPreparedHandoff(f.context, ready.input, regenerated),
    ).rejects.toThrow("file evidence changed after owner review");
    expect(
      await cluster.database.mediaHandoffReceipt.count({
        where: { planId: f.planId },
      }),
    ).toBe(0);
    expect(
      await cluster.database.libraryAsset.findUnique({
        where: { path: f.target },
      }),
    ).toBeNull();
    expect(await readFile(f.target, "utf8")).toBe(f.bytes);
  },
);

test("current owner restriction rejects queued apply and never credits the preparer", async () => {
  const f = await fixture();
  const db = cluster.database;
  const approver = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Second owner",
      role: "owner",
      restricted: false,
    },
  });
  const ready = await f.ready(approver);
  await db.mediaUser.update({
    where: { id: approver.id },
    data: { restricted: true },
  });
  await expect(
    applyPreparedHandoff(f.context, ready.input, ready.prepared),
  ).rejects.toThrow("owner authority changed");
  await db.mediaUser.update({
    where: { id: approver.id },
    data: { restricted: false },
  });
  const receiptId = await applyPreparedHandoff(
    f.context,
    ready.input,
    ready.prepared,
  );
  expect(
    await db.mediaHandoffReceipt.findUniqueOrThrow({
      where: { id: receiptId },
    }),
  ).toMatchObject({ actorId: approver.id });
});

test("a concurrent intent edit commits while full hashing runs and makes final proof obsolete", async () => {
  const f = await fixture();
  const ready = await f.ready();
  let edited = false;
  f.context.files.checkpoint = async () => {
    if (edited) return;
    edited = true;
    await cluster.database.mediaItem.update({
      where: { id: f.network.media.id },
      data: { version: { increment: 1 } },
    });
  };
  const fresh = await prepareHandoffFiles(f.context, f.planId);
  expect(edited).toBe(true);
  await expect(
    applyPreparedHandoff(f.context, ready.input, fresh),
  ).rejects.toThrow("media intent changed");
  expect(
    await cluster.database.mediaHandoffReceipt.count({
      where: { planId: f.planId },
    }),
  ).toBe(0);
});

test.each(["epoch", "profile", "writer-resumed", "sidecar"] as const)(
  "reviewed apply protects when %s evidence changes",
  async (change) => {
    const f = await fixture();
    const ready = await f.ready();
    const db = cluster.database;
    if (change === "epoch")
      await db.mediaRuntimeState.update({
        where: { id: "singleton" },
        data: { recoveryEpoch: { increment: 1 } },
      });
    if (change === "profile")
      await db.qualityProfile.update({
        where: { id: f.profile.id },
        data: { version: { increment: 1 } },
      });
    if (change === "writer-resumed")
      await db.legacyWriterLease.update({
        where: { id: "singleton" },
        data: { observedAt: new Date(), revokedAt: new Date() },
      });
    if (change === "sidecar")
      await writeFile(
        f.target.replace(/\.mkv$/u, ".en.srt"),
        "Unknown subtitle",
      );
    await expect(
      applyPreparedHandoff(f.context, ready.input, ready.prepared),
    ).rejects.toThrow();
    expect(
      await db.mediaHandoffReceipt.count({ where: { planId: f.planId } }),
    ).toBe(0);
    expect(
      await db.libraryAsset.findUnique({ where: { path: f.target } }),
    ).toBeNull();
  },
);
