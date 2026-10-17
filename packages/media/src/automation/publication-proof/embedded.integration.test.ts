import { afterAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { PublicationIntentSchema } from "#shared/publication-proof/intent.ts";
import { mappedPublicationFixture } from "./test-fixture.ts";
import { embeddedFixtureSource } from "./embedded-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});
test("actual ffmpeg embedded extraction becomes validated candidate bytes through ordinary recorded publication", async () => {
  const db = harness.database();
  const f = await mappedPublicationFixture(db);
  directories.push(f.directory);
  await db.mediaRequest.update({
    where: { id: f.request.id },
    data: { subtitleLanguages: ["en"], version: { increment: 1 } },
  });
  const acquired = await f.acquisition();
  await embeddedFixtureSource(db, f, acquired);
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  const transition = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: acquired.attempt.id },
  });
  const entry = PublicationIntentSchema.parse(transition.intent).entries[0]
    ?.entry;
  expect(entry?.embeddedSubtitles).toHaveLength(1);
  const extracted = entry?.embeddedSubtitles[0];
  if (extracted === undefined)
    throw new Error("Actual extracted subtitle missing");
  const candidate = await db.subtitleAsset.findUniqueOrThrow({
    where: { id: extracted.id },
  });
  expect(candidate).toMatchObject({
    state: "validated",
    qualityStatus: "accepted",
    storageKind: "sidecar",
    ownershipEpoch: 0,
  });
  expect(new TextDecoder().decode(candidate.content ?? undefined)).toContain(
    "Actual extracted successor caption.",
  );
});
