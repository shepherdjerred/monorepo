import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { prepareBoundRetention } from "#automation/retention/lifecycle.test-fixture.ts";
import { automaticSubtitleHarness } from "./test-fixture.ts";
import {
  quarantineFixtureWithElapsedGrace,
  prepareAutomaticFixtureReplacement,
} from "#testing/retention/movie-fixtures.ts";
import { continueFixtureRequest } from "#testing/retention-interest.ts";
const harness = automaticSubtitleHarness();

test("an automatic caption keeps its bytes and ancestry through actual native quarantine and restore", async () => {
  const f = await harness.setup("native", true);
  const {
    prepared,
    files: replacements,
    approve,
  } = await prepareAutomaticFixtureReplacement(f);
  await approve();
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
  await quarantineFixtureWithElapsedGrace(f, bound);
  const prior = await f.db.operation.findMany({
    where: { targetId: f.media.id },
    select: { id: true },
  });
  const { request } = await continueFixtureRequest(f.db, f.user, f.request.id);
  const restore = await f.db.operation.findFirstOrThrow({
    where: {
      kind: "restore_media",
      targetId: f.media.id,
      id: { notIn: prior.map((operation) => operation.id) },
      payload: { path: ["requestId"], equals: request.id },
    },
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
