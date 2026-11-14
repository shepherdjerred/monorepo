import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { createSubtitleReplacementActivities } from "#automation/subtitle-replacement/activities.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { automaticSubtitleHarness } from "./test-fixture.ts";
const harness = automaticSubtitleHarness();
test("real automatic upgrade swaps captions through native review/receipt without human approval", async () => {
  const f = await harness.setup();
  const input = { job: f.job, candidateSubtitleId: f.candidate.id };
  const prepared = await f.automatic.begin(input);
  if (prepared === null) throw new Error("Automatic preparation missing");
  const files = createSubtitleReplacementActivities(f.context);
  expect(
    await files.prepareSubtitleReplacement({
      replacementId: prepared.replacementId,
      operationId: prepared.preparationOperationId,
    }),
  ).toEqual({ state: "ready" });
  expect(
    await f.automatic.approve({
      ...input,
      replacementId: prepared.replacementId,
    }),
  ).toBe("queued");
  const row = await f.db.subtitleReplacement.findUniqueOrThrow({
    where: { id: prepared.replacementId },
    include: { review: true },
  });
  expect(row.review?.approvedById).toBeNull();
  expect(row.review?.approvedAt).toBeNull();
  if (row.coordinatorOperationId === null)
    throw new Error("Automatic coordinator missing");
  expect(
    await files.applySubtitleReplacement({
      replacementId: row.id,
      operationId: row.coordinatorOperationId,
    }),
  ).toEqual({ state: "applied" });
  expect(await readFile(workerFilePath(f.context, f.path), "utf8")).toBe(
    f.newText,
  );
  expect(await f.automatic.approve({ ...input, replacementId: row.id })).toBe(
    "queued",
  );
  expect(
    await f.db.applicationEvent.count({
      where: {
        kind: "subtitle_automatic_upgrade_authorized_v1",
        dedupeKey: `subtitle-automatic-authorization:${row.id}`,
      },
    }),
  ).toBe(1);
});
test("a source without its actual claimed provider download cannot obtain automatic ancestry", async () => {
  const f = await harness.setup("missing-event");
  await expect(
    f.automatic.begin({ job: f.job, candidateSubtitleId: f.candidate.id }),
  ).rejects.toThrow();
  expect(
    await f.db.applicationEvent.count({
      where: { kind: "subtitle_automatic_upgrade_candidate_v1" },
    }),
  ).toBe(0);
});
test("an installed caption changed since the scheduled search remains untouched", async () => {
  const f = await harness.setup();
  await f.db.subtitleAsset.update({
    where: { id: f.old.id },
    data: { version: { increment: 1 } },
  });
  await expect(
    f.automatic.begin({ job: f.job, candidateSubtitleId: f.candidate.id }),
  ).rejects.toThrow("subtitle_automatic_upgrade_changed");
  expect(await readFile(workerFilePath(f.context, f.path), "utf8")).toBe(
    f.oldText,
  );
});
test("a fabricated automatic marker is refused by native deferred authority", async () => {
  const f = await harness.setup();
  await expect(
    f.db.subtitleAsset.update({
      where: { id: f.candidate.id },
      data: {
        matchingEvidence: {
          automaticSubtitleUpgradeV1: {
            schemaVersion: 1,
            eventId: crypto.randomUUID(),
          },
        },
      },
    }),
  ).rejects.toThrow();
});

test("disabling automatic maintenance at the effect checkpoint preserves installed bytes", async () => {
  const f = await harness.setup();
  const input = { job: f.job, candidateSubtitleId: f.candidate.id };
  const prepared = await f.automatic.begin(input);
  if (prepared === null) throw new Error("Automatic preparation missing");
  const files = createSubtitleReplacementActivities(f.context);
  await files.prepareSubtitleReplacement({
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
  f.context.checkpoint = async (phase) => {
    if (phase === "subtitle-replacement-authorized")
      f.context.enabled.subtitleMaintenance = () => Promise.resolve(false);
  };
  expect(
    await files.applySubtitleReplacement({
      replacementId: row.id,
      operationId: row.coordinatorOperationId,
    }),
  ).toEqual({ state: "protected", reason: "subtitle_maintenance_disabled" });
  expect(await readFile(workerFilePath(f.context, f.path), "utf8")).toBe(
    f.oldText,
  );
  expect(
    await f.db.subtitleReplacementReceipt.count({
      where: { replacementId: row.id },
    }),
  ).toBe(0);
});

test("actual download checkpoint and journal event cannot be erased or substituted", async () => {
  const f = await harness.setup();
  await expect(
    f.db.operation.update({
      where: { id: f.job.operationId },
      data: { result: {} },
    }),
  ).rejects.toThrow();
  await expect(
    f.db.applicationEvent.updateMany({
      where: {
        kind: "subtitle_download_requested",
        payload: { path: ["operationId"], equals: f.job.operationId },
      },
      data: { payload: { providerId: "different" } },
    }),
  ).rejects.toThrow();
});

test("native regular-caption predicate binds measured coverage to the exact video and subtitle digests", async () => {
  const f = await harness.setup();
  const proof = {
    schemaVersion: 1,
    detector: "ffsubsync-0.5.1/webrtc",
    videoChecksum: f.asset.checksum,
    subtitleChecksum: f.candidate.checksum,
    runtimeMs: 240_000,
    speechMs: 120_000,
    coveredSpeechMs: 120_000,
    windows: Array.from({ length: 12 }, () => ({
      speechMs: 10_000,
      coveredSpeechMs: 10_000,
    })),
  };
  const caption = await f.db.subtitleAsset.update({
    where: { id: f.candidate.id },
    data: { forced: null, matchingEvidence: { regularDialogueV1: proof } },
  });
  const read = () =>
    f.db
      .$queryRaw`SELECT media_subtitle_regular_dialogue_v1(s) AS valid FROM "SubtitleAsset" s WHERE s.id=${caption.id}`;
  expect(await read()).toEqual([{ valid: true }]);
  await f.db.subtitleAsset.update({
    where: { id: caption.id },
    data: {
      matchingEvidence: {
        regularDialogueV1: { ...proof, subtitleChecksum: "f".repeat(64) },
      },
    },
  });
  expect(await read()).toEqual([{ valid: false }]);
  await f.db.subtitleAsset.update({
    where: { id: caption.id },
    data: {
      matchingEvidence: {
        regularDialogueV1: { ...proof, coveredSpeechMs: 1000 },
      },
    },
  });
  expect(await read()).toEqual([{ valid: false }]);
});
