import { expect, test } from "vitest";
import { copyFile, rename, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { replacementHarness } from "./test-fixture.ts";

const harness = replacementHarness();

test("fresh owner can compensate interrupted publication after creator demotion", async () => {
  const f = await harness.setup();
  const input = await f.approve();
  f.context.checkpoint = async (phase) => {
    if (phase === "subtitle-replacement-before-receipt")
      throw new Error("Interrupted");
  };
  await expect(f.activities().applySubtitleReplacement(input)).rejects.toThrow(
    "Interrupted",
  );
  await f.db.mediaUser.update({
    where: { id: f.owner.id },
    data: { role: "member" },
  });
  const nextOwner = await f.db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "New fixture owner",
      role: "owner",
    },
  });
  f.context.checkpoint = () => Promise.resolve();
  expect(await f.reconcile(nextOwner)).toEqual({ state: "rolled_back" });
  expect(await readFile(f.filename, "utf8")).toBe(f.oldText);
  expect(await f.row()).toMatchObject({ receipt: { outcome: "compensated" } });
});

test.each(["source", "oldArchive"] as const)(
  "cleanup protects a same-byte foreign %s inode",
  async (name) => {
    const f = await harness.setup();
    const input = await f.approve();
    expect(await f.activities().applySubtitleReplacement(input)).toEqual({
      state: "applied",
    });
    const paths = await f.paths();
    const filename = paths[name];
    await copyFile(filename, `${filename}.foreign`);
    await rename(`${filename}.foreign`, filename);
    f.advance(8 * 86_400_000);
    expect(await f.cleanup()).toMatchObject({
      state: "protected",
      reason: "subtitle_replacement_artifact_identity_changed",
    });
    expect(await readFile(filename, "utf8")).toBe(
      name === "source" ? f.newText : f.oldText,
    );
  },
);

test("a reused partial prefix is protected even if it matches candidate bytes", async () => {
  const f = await harness.setup();
  const input = await f.approve();
  expect(await f.activities().applySubtitleReplacement(input)).toEqual({
    state: "applied",
  });
  const paths = await f.paths();
  const partial = paths.partial;
  await writeFile(partial, f.newText.slice(0, 10));
  f.advance(8 * 86_400_000);
  expect(await f.cleanup()).toMatchObject({
    state: "protected",
    reason: "subtitle_replacement_artifact_path_reused",
  });
  expect(await readFile(partial, "utf8")).toBe(f.newText.slice(0, 10));
});

test("untracked same-video neighbor prevents read-only review", async () => {
  const f = await harness.setup();
  await writeFile(
    path.join(
      path.dirname(f.filename),
      `${path.basename(f.asset.path, path.extname(f.asset.path))}.fr.srt`,
    ),
    f.oldText,
  );
  expect(
    await f.activities().prepareSubtitleReplacement(f.prepareInput),
  ).toMatchObject({
    state: "protected",
    reason: "subtitle_replacement_neighbor_unowned",
  });
  expect(await f.row()).toMatchObject({ review: null });
});

test("stale target changes never publish and preserve original quality evidence", async () => {
  const f = await harness.setup();
  const input = await f.approve();
  await f.db.mediaRequest.update({
    where: { id: f.request.id },
    data: { subtitleLanguages: [], version: { increment: 1 } },
  });
  expect(await f.activities().applySubtitleReplacement(input)).toMatchObject({
    state: "protected",
    reason: "subtitle_target_changed",
  });
  expect(await readFile(f.filename, "utf8")).toBe(f.oldText);
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: f.old.id } }),
  ).toEqual(f.old);
});

test("normal installer cannot execute a review-only candidate", async () => {
  const f = await harness.setup();
  const { createMediaFileActivities } =
    await import("#automation/files/activities.ts");
  expect(
    await createMediaFileActivities(f.context).installMediaSubtitles({
      operationId: crypto.randomUUID(),
      subtitleId: f.candidateId,
    }),
  ).toEqual({ status: "obsolete" });
  expect(await readFile(f.filename, "utf8")).toBe(f.oldText);
});
