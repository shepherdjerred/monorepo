import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { expect, test } from "vitest";
import { readFile, copyFile, rename, writeFile } from "node:fs/promises";
import { replacementHarness } from "./test-fixture.ts";

const harness = replacementHarness();
for (const quality of ["accepted", "unverified", "rejected"] as const)
  test(`owner replaces ${quality} bytes preserving evidence and video version, then cleans exact archive`, async () => {
    const f = await harness.setup(quality);
    const input = await f.approve();
    expect(await f.activities().applySubtitleReplacement(input)).toEqual({
      state: "applied",
    });
    expect(await readFile(f.filename, "utf8")).toBe(f.newText);
    const old = await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: f.old.id },
    });
    expect(old).toMatchObject({
      state: "superseded",
      qualityStatus: quality,
      provenance: f.old.provenance,
      matchingEvidence: f.old.matchingEvidence,
      videoVersion: f.asset.version,
    });
    expect(await readFile(old.path ?? "", "utf8")).toBe(f.oldText);
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toEqual(f.asset);
    expect(await f.activities().applySubtitleReplacement(input)).toEqual({
      state: "applied",
    });
    expect(await f.cleanup()).toMatchObject({ state: "waiting" });
    f.advance(8 * 86_400_000);
    expect(await f.cleanup()).toEqual({ state: "cleaned" });
    expect(await readFile(f.filename, "utf8")).toBe(f.newText);
    expect(
      await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: f.old.id } }),
    ).toMatchObject({ state: "purged", qualityStatus: quality });
    const paths = await f.paths();
    for (const name of [
      "oldArchive",
      "source",
      "staged",
      "partial",
      "rejected",
      "rollbackStaged",
    ] as const)
      await expect(readFile(paths[name])).rejects.toMatchObject({
        code: "ENOENT",
      });
  });

test("promotion survives DB rollback and identical retry completes exactly one receipt", async () => {
  const f = await harness.setup();
  const input = await f.approve();
  f.context.checkpoint = async (phase) => {
    if (phase === "subtitle-replacement-before-receipt")
      throw new Error("Simulated worker death");
  };
  await expect(f.activities().applySubtitleReplacement(input)).rejects.toThrow(
    "Simulated worker death",
  );
  expect(await readFile(f.filename, "utf8")).toBe(f.newText);
  expect(await f.row()).toMatchObject({ receipt: null });
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: f.old.id } }),
  ).toEqual(f.old);
  f.context.checkpoint = () => Promise.resolve();
  expect(await f.activities().applySubtitleReplacement(input)).toEqual({
    state: "applied",
  });
  expect(
    await f.db.subtitleReplacementReceipt.count({
      where: { replacementId: f.replacementId },
    }),
  ).toBe(1);
});

test("cancelled intent compensates an interrupted swap and both archives expire", async () => {
  const f = await harness.setup();
  const input = await f.approve();
  f.context.checkpoint = async (phase) => {
    if (phase === "subtitle-replacement-before-receipt")
      throw new Error("Interrupted");
  };
  await expect(f.activities().applySubtitleReplacement(input)).rejects.toThrow(
    "Interrupted",
  );
  await f.db.mediaIntent.update({
    where: targetWhere(defaultScope(f.media.id)),
    data: { desiredPresence: false, generation: { increment: 1 } },
  });
  f.context.checkpoint = () => Promise.resolve();
  expect(await f.reconcile()).toEqual({ state: "rolled_back" });
  expect(await readFile(f.filename, "utf8")).toBe(f.oldText);
  expect(await f.row()).toMatchObject({ receipt: { outcome: "compensated" } });
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: f.old.id } }),
  ).toEqual(f.old);
  f.advance(8 * 86_400_000);
  expect(await f.cleanup()).toEqual({ state: "cleaned" });
});

test("same-byte foreign promoted inode remains reserved and is never adopted", async () => {
  const f = await harness.setup();
  const input = await f.approve();
  f.context.checkpoint = async (phase) => {
    if (phase === "subtitle-replacement-before-receipt")
      throw new Error("Interrupted");
  };
  await expect(f.activities().applySubtitleReplacement(input)).rejects.toThrow(
    "Interrupted",
  );
  await copyFile(f.filename, `${f.filename}.foreign`);
  await rename(`${f.filename}.foreign`, f.filename);
  f.context.checkpoint = () => Promise.resolve();
  expect(await f.reconcile()).toMatchObject({
    state: "protected",
    reason: "subtitle_replacement_artifact_identity_changed",
  });
  expect(await f.row()).toMatchObject({ reservationActive: true });
});

test("changed reviewed old bytes and unknown neighbors protect before publication", async () => {
  const f = await harness.setup();
  const input = await f.approve();
  await writeFile(f.filename, "foreign");
  expect(await f.activities().applySubtitleReplacement(input)).toMatchObject({
    state: "protected",
  });
  expect(await readFile(f.filename, "utf8")).toBe("foreign");
  expect(await f.row()).toMatchObject({ receipt: null });
});

test("read-only preparation abandonment releases only proven empty artifact scope", async () => {
  const f = await harness.setup();
  expect(
    await f.activities().prepareSubtitleReplacement(f.prepareInput),
  ).toEqual({ state: "ready" });
  expect(await f.reconcile()).toEqual({ state: "rolled_back" });
  expect(await f.row()).toMatchObject({ reservationActive: false });
  expect(await f.row()).toMatchObject({ receipt: { outcome: "abandoned" } });
});
