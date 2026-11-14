import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createSubtitleReplacementActivities } from "#automation/subtitle-replacement/activities.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { prepareBoundRetention } from "#automation/retention/lifecycle.test-fixture.ts";
import { elapsedQuarantineClient } from "#automation/files/plex-binding/elapsed-quarantine.test-support.ts";
import { automaticSubtitleHarness } from "./test-fixture.ts";
const harness = automaticSubtitleHarness();

test("an automatic caption keeps its bytes and ancestry through actual native quarantine and restore", async () => {
  const f = await harness.setup("native", true);
  const input = { job: f.job, candidateSubtitleId: f.candidate.id };
  const prepared = await f.automatic.begin(input);
  if (prepared === null) throw new Error("Automatic preparation missing");
  const replacements = createSubtitleReplacementActivities(f.context);
  await replacements.prepareSubtitleReplacement({
    replacementId: prepared.replacementId,
    operationId: prepared.preparationOperationId,
  });
  await f.automatic.approve({
    ...input,
    replacementId: prepared.replacementId,
  });
  const row = await f.db.subtitleReplacement.findUniqueOrThrow({
    where: { id: prepared.replacementId },
  });
  if (row.coordinatorOperationId === null)
    throw new Error("Automatic coordinator missing");
  expect(
    await replacements.applySubtitleReplacement({
      replacementId: row.id,
      operationId: row.coordinatorOperationId,
    }),
  ).toEqual({ state: "applied" });
  const installed = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: f.candidate.id },
  });
  const bound = await prepareBoundRetention(f, f.initialPublication, f.network);
  const timing = await elapsedQuarantineClient(f.db, {
    ...bound.retention.input,
    mediaIds: [f.media.id],
  });
  f.context.db = timing.db;
  try {
    expect(await bound.quarantine()).toEqual({ status: "quarantined" });
  } finally {
    f.context.db = f.db;
  }
  await timing.assertCommitted();
  await bound.observe(false);
  const restore = await f.db.operation.findFirstOrThrow({
    where: { kind: "restore_media", targetId: f.media.id },
    orderBy: { createdAt: "desc" },
  });
  const restoreInput = z
    .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
    .parse(restore.payload);
  expect(
    await createMediaFileActivities(f.context).restoreMediaFiles(restoreInput),
  ).toEqual({ status: "restored" });
  const caption = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: f.candidate.id },
  });
  expect(caption.state).toBe("installed");
  expect(caption.videoVersion).toBeGreaterThan(
    z.int().parse(installed.videoVersion),
  );
  expect(caption.provenance).toEqual(installed.provenance);
  expect(caption.matchingEvidence).toEqual(installed.matchingEvidence);
  expect(await readFile(workerFilePath(f.context, f.path), "utf8")).toBe(
    f.newText,
  );
});
