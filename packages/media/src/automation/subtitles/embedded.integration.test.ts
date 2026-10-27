import { afterEach, beforeAll, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieFilesV4Fixture } from "#testing/movie-files-v4.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { inspectAndStageMovieV4 } from "#automation/files/movie-editions/inspection.ts";
import { promoteMovieV4 } from "#automation/files/movie-editions/publication.ts";
import { createSubtitleActivities } from "#automation/subtitles.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import {
  currentSubtitleWork,
  SubtitleWorkSchema,
  subtitleTargetsReady,
} from "./authority.ts";
import { queueCurrentSubtitleTargets } from "./queue.ts";
import { reusableEmbeddedSubtitle } from "./embedded.ts";
import { embeddedStreamFacts } from "#shared/subtitles/stream-facts.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { installSubtitle } from "#automation/files/subtitles.ts";

const h = automationTestHarness();
const directories: string[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const f = await movieFilesV4Fixture(
    h.database(),
    h.context(),
    await h.fixture(),
    { bytes, edition: "default" },
  );
  directories.push(f.files.directory);
  await inspectAndStageMovieV4(f.files.context, f.input);
  await promoteMovieV4(f.files.context, f.input);
  const coverage = await h.database().assetCoverage.findFirstOrThrow({
    where: { mediaId: f.media.id, edition: "default", current: true },
  });
  return { ...f, assetId: coverage.assetId };
}

test("actual probed English and Chinese extractions satisfy queued targets without providers and bind their installation to the actual command", async () => {
  const f = await fixture();
  const db = h.database();
  const publication = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: f.attempt.id },
  });
  expect(
    await db.$transaction((tx) =>
      queueCurrentSubtitleTargets(tx, { assetId: f.assetId, epoch: 0 }),
    ),
  ).toBe(2);
  let providerCalls = 0;
  const network = createSubtitleActivities(f.context, {
    opensubtitles: () => {
      providerCalls++;
      return Promise.resolve(null);
    },
  });
  const operations = await db.operation.findMany({
    where: { kind: "acquire_subtitles", targetId: f.assetId },
    orderBy: { id: "asc" },
  });
  const originalWork = await currentSubtitleWork(db, f.assetId, 0);
  const facts = embeddedStreamFacts(originalWork.asset.properties);
  expect(facts?.streams).toHaveLength(2);
  for (const operation of operations) {
    const input = SubtitleWorkSchema.extend({
      operationId: z.uuid(),
      assetId: z.uuid(),
    }).parse(operation.payload);
    const result = await network.findMediaSubtitles({
      operationId: input.operationId,
      assetId: input.assetId,
      language: input.language,
      ...(input.forced === undefined ? {} : { forced: input.forced }),
      ...(input.hearingImpaired === undefined
        ? {}
        : { hearingImpaired: input.hearingImpaired }),
      ...(input.targetAuthority === undefined
        ? {}
        : { targetAuthority: input.targetAuthority }),
    });
    expect(result.status).toBe("found");
    const subtitleId = z.uuid().parse(result.subtitleId);
    const before = await db.subtitleAsset.findUniqueOrThrow({
      where: { id: subtitleId },
    });
    expect(before).toMatchObject({
      state: "validated",
      forced: false,
      hearingImpaired: false,
      matchingEvidence: { embeddedSourceV2: { schemaVersion: 2 } },
    });
    expect(before.matchingEvidence).not.toHaveProperty("targetAuthority");
    expect(
      await createMediaFileActivities(f.files.context).installMediaSubtitles({
        operationId: operation.id,
        subtitleId,
      }),
    ).toEqual({ status: "installed" });
    const installed = await db.subtitleAsset.findUniqueOrThrow({
      where: { id: subtitleId },
    });
    expect(installed).toMatchObject({
      state: "installed",
      version: 1,
      matchingEvidence: {
        targetAuthority: originalWork.authority,
        target: { language: input.language, hearingImpaired: "any" },
      },
    });
    expect(
      await readFile(
        workerFilePath(f.files.context, z.string().parse(installed.path)),
      ),
    ).toEqual(Buffer.from(before.content ?? []));
    const currentWork = await currentSubtitleWork(db, f.assetId, 0);
    expect(currentWork.authority).toBe(originalWork.authority);
  }
  expect(providerCalls).toBe(0);
  expect(
    subtitleTargetsReady(await currentSubtitleWork(db, f.assetId, 0), 0),
  ).toBe(true);
  expect(
    await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: publication.id },
    }),
  ).toEqual(publication);
});

test("new extraction markers fail on mismatched video or stream facts while historical absent observations stay unknown", async () => {
  const f = await fixture();
  const work = await currentSubtitleWork(h.database(), f.assetId, 0);
  const subtitle = work.asset.subtitles[0];
  if (subtitle === undefined) throw new Error("Actual extraction missing");
  expect(reusableEmbeddedSubtitle(subtitle, work.asset)).toBe(true);
  expect(() =>
    reusableEmbeddedSubtitle(subtitle, {
      ...work.asset,
      checksum: "0".repeat(64),
    }),
  ).toThrow("actual extraction");
  expect(() =>
    reusableEmbeddedSubtitle({ ...subtitle, forced: true }, work.asset),
  ).toThrow("actual extraction");
  expect(() =>
    reusableEmbeddedSubtitle(subtitle, { ...work.asset, properties: {} }),
  ).toThrow("actual extraction");
  expect(
    reusableEmbeddedSubtitle(
      { ...subtitle, matchingEvidence: {} },
      { ...work.asset, properties: {} },
    ),
  ).toBe(false);
  expect(() =>
    embeddedStreamFacts({ embeddedStreamFactsV2: { schemaVersion: 2 } }),
  ).toThrow();
});

test("changed extraction bytes are rejected before a library caption is written", async () => {
  const f = await fixture();
  const db = h.database();
  await db.$transaction((tx) =>
    queueCurrentSubtitleTargets(tx, { assetId: f.assetId, epoch: 0 }),
  );
  const operation = await db.operation.findFirstOrThrow({
    where: { kind: "acquire_subtitles", targetId: f.assetId },
  });
  const subtitle = await db.subtitleAsset.findFirstOrThrow({
    where: {
      assetId: f.assetId,
      language: z.object({ language: z.string() }).parse(operation.payload)
        .language,
    },
  });
  await db.subtitleAsset.update({
    where: { id: subtitle.id },
    data: {
      content: new TextEncoder().encode(
        "1\n00:00:00,000 --> 00:00:01,000\nDifferent caption bytes\n",
      ),
    },
  });
  await expect(
    installSubtitle(f.files.context, subtitle.id, operation.id),
  ).rejects.toMatchObject({ reason: "subtitle_content_changed" });
  expect(
    await db.subtitleAsset.findUniqueOrThrow({ where: { id: subtitle.id } }),
  ).toMatchObject({ state: "validated", path: null, version: 0 });
});
