import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieFilesV4Fixture } from "#testing/movie-files-v4.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { MovieSubtitleOperationV4Schema } from "#shared/movie-editions/subtitles-v4.ts";
import { inspectAndStageMovieV4 } from "#automation/files/movie-editions/inspection.ts";
import { promoteMovieV4 } from "#automation/files/movie-editions/publication.ts";
import { installMovieSubtitlesV4 } from "#automation/files/movie-editions/subtitles.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { queueMovieSubtitleTargetsV4 } from "./queue.ts";
import { findMovieSubtitlesV4 } from "./network.ts";
import { currentMovieSubtitleWorkV4 } from "./authority.ts";
import { subtitleTargetsReady } from "#automation/subtitles/authority.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readMovieSubtitleReceiptV4 } from "#infrastructure/movie-editions/subtitle-receipt.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { findMoviePublicationReferenceV2 } from "#infrastructure/movie-editions/publication/store.ts";
import { subtitleDestination } from "#domain/subtitle-path.ts";
import { grantTestLease } from "#testing/authority.ts";

const h = automationTestHarness();
const directories: string[] = [];
const access = { serverMachineId: "fixture-server", movieSectionId: "1" };
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture(edition: MovieEditionKey = "extended_cut") {
  const db = h.database();
  const f = await movieFilesV4Fixture(db, h.context(), await h.fixture(), {
    bytes,
    edition,
  });
  directories.push(f.files.directory);
  await inspectAndStageMovieV4(f.files.context, f.input);
  await promoteMovieV4(f.files.context, f.input);
  const coverage = await db.assetCoverage.findFirstOrThrow({
    where: { mediaId: f.media.id, edition, current: true },
  });
  const assetId = coverage.assetId;
  const queue = () =>
    db.$transaction((tx) =>
      queueMovieSubtitleTargetsV4(tx, {
        scope: f.input.scope,
        assetId,
        epoch: 0,
        access,
      }),
    );
  const work = () =>
    currentMovieSubtitleWorkV4(
      db,
      { scope: f.input.scope, assetId, epoch: 0, access },
      new PublicationAuthorityReadBudget(),
    );
  const inputs = async () => {
    const operations = await db.operation.findMany({
      where: { kind: "acquire_movie_subtitles_v4", targetId: assetId },
      orderBy: { id: "asc" },
    });
    return operations.map((row) =>
      MovieSubtitleOperationV4Schema.parse(
        z.object(MovieSubtitleOperationV4Schema.shape).parse(row.payload),
      ),
    );
  };
  return { ...f, db, assetId, queue, work, inputs };
}

async function selected(f: Awaited<ReturnType<typeof fixture>>) {
  await f.queue();
  const [target] = await f.inputs();
  if (target === undefined) throw new Error("Actual subtitle target missing");
  const found = await findMovieSubtitlesV4(f.context, target, {});
  expect(found.status).toBe("found");
  return {
    target,
    input: {
      schemaVersion: 4 as const,
      operationId: target.operationId,
      scope: target.scope,
      assetId: f.assetId,
      subtitleId: z.uuid().parse(found.subtitleId),
    },
  };
}

test.each(MovieEditionKeySchema.options)(
  "actual %s caption installation preserves exact cut, original publication and completed retry",
  async (edition) => {
    const f = await fixture(edition);
    const publication = await f.db.mediaPublicationTransition.findUniqueOrThrow(
      { where: { attemptId: f.attempt.id } },
    );
    expect(await f.queue()).toBe(2);
    expect(await f.queue()).toBe(0);
    const originalWork = await f.work();
    const authority = originalWork.authority;
    const completed = [];
    for (const target of await f.inputs()) {
      const found = await findMovieSubtitlesV4(f.context, target, {});
      expect(found.status).toBe("found");
      const input = {
        schemaVersion: 4 as const,
        operationId: target.operationId,
        scope: target.scope,
        assetId: f.assetId,
        subtitleId: z.uuid().parse(found.subtitleId),
      };
      const before = await f.db.subtitleAsset.findUniqueOrThrow({
        where: { id: input.subtitleId },
      });
      await installMovieSubtitlesV4(f.files.context, input);
      const receipt = await readMovieSubtitleReceiptV4(
        f.db,
        input,
        new PublicationAuthorityReadBudget(),
      );
      expect(receipt).toMatchObject({
        schemaVersion: 4,
        input,
        before: { state: "validated", version: 0 },
        after: {
          state: "installed",
          version: 1,
          forced: false,
          hearingImpaired: false,
          matchingEvidence: {
            movieScope: input.scope,
            movieInstallationV4: { operationId: input.operationId },
          },
        },
        journal: { phase: "complete" },
      });
      const installed = await f.db.subtitleAsset.findUniqueOrThrow({
        where: { id: input.subtitleId },
      });
      expect(
        await readFile(
          workerFilePath(f.files.context, z.string().parse(installed.path)),
        ),
      ).toEqual(Buffer.from(before.content ?? []));
      const currentWork = await f.work();
      expect(currentWork.authority).toBe(authority);
      await installMovieSubtitlesV4(f.files.context, input);
      completed.push(input);
    }
    expect(subtitleTargetsReady(await f.work(), 0)).toBe(true);
    expect(await f.queue()).toBe(0);
    const budget = new PublicationAuthorityReadBudget();
    const asset = await snapshotMoviePublicationAssetV2(
      f.db,
      f.input.scope,
      f.assetId,
      budget,
    );
    const grant = await findMoviePublicationReferenceV2(
      f.db,
      { scope: f.input.scope, asset },
      budget,
    );
    expect(
      grant?.subtitleLineage?.installations.map((row) => row.subtitleId).sort(),
    ).toEqual(completed.map((row) => row.subtitleId).sort());
    expect(
      await f.db.mediaPublicationTransition.findUniqueOrThrow({
        where: { id: publication.id },
      }),
    ).toEqual(publication);
    const currentTarget = await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition } },
    });
    const request = await f.db.mediaRequest.findUniqueOrThrow({
      where: { id: f.result.requestId },
    });
    const user = await f.db.mediaUser.findUniqueOrThrow({
      where: { id: f.result.subjectUserId },
    });
    await f.commands.cancelMovieEditionRequest(
      { ...user, role: "member" },
      crypto.randomUUID(),
      {
        schemaVersion: 3,
        action: "cancel_request",
        subjectUserId: user.id,
        scope: f.input.scope,
        requestId: request.id,
        expected: {
          targetVersion: currentTarget.version,
          requestVersion: request.version,
          choiceRevision: request.movieEditionChoiceRevision,
        },
      },
    );
    f.files.context.permittedMovieSection = () =>
      Promise.reject(new Error("Completed retry must precede configuration"));
    for (const input of completed) {
      await installMovieSubtitlesV4(f.files.context, input);
      const command = await f.db.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      });
      await expect(
        f.db.operation.update({
          where: { id: command.id },
          data: { result: {} },
        }),
      ).rejects.toThrow("immutable");
    }
  },
);

test("another cut cannot use the queued operation or extraction", async () => {
  const f = await fixture();
  const { target, input } = await selected(f);
  const other = { ...input.scope, edition: "theatrical_cut" as const };
  await expect(
    findMovieSubtitlesV4(f.context, { ...target, scope: other }, {}),
  ).rejects.toMatchObject({ reason: "subtitle_operation_changed" });
  await expect(
    installMovieSubtitlesV4(f.files.context, { ...input, scope: other }),
  ).rejects.toMatchObject({ reason: "subtitle_operation_changed" });
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: input.subtitleId },
    }),
  ).toMatchObject({ state: "validated", path: null });
});

test("even identical unmanaged destination bytes require review rather than creating ownership", async () => {
  const f = await fixture();
  const { input } = await selected(f);
  const subtitle = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: input.subtitleId },
    include: { asset: true },
  });
  const target = subtitleDestination({
    videoPath: workerFilePath(f.files.context, subtitle.asset.path),
    language: subtitle.language,
    forced: subtitle.forced,
    hearingImpaired: subtitle.hearingImpaired,
    format: z
      .object({ format: z.enum(["srt", "ass", "ssa", "vtt"]) })
      .parse(subtitle.provenance).format,
  });
  const captionBytes = Buffer.from(subtitle.content ?? []);
  await writeFile(target, captionBytes, { flag: "wx" });
  await expect(installMovieSubtitlesV4(f.files.context, input)).rejects.toThrow(
    "requires owner review",
  );
  expect(await readFile(target)).toEqual(captionBytes);
  expect(
    await readMovieSubtitleReceiptV4(
      f.db,
      input,
      new PublicationAuthorityReadBudget(),
    ),
  ).toBeNull();
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: subtitle.id } }),
  ).toMatchObject({ state: "validated", version: 0, path: null });
});

test("a crash after actual publication retries the original Files journal without rewriting the original video proof", async () => {
  const f = await fixture();
  const { input } = await selected(f);
  f.files.context.checkpoint = (phase) =>
    phase === "movie-subtitle-before-commit"
      ? Promise.reject(new Error("Actual caption crash"))
      : Promise.resolve();
  await expect(installMovieSubtitlesV4(f.files.context, input)).rejects.toThrow(
    "Actual caption crash",
  );
  expect(
    await readMovieSubtitleReceiptV4(
      f.db,
      input,
      new PublicationAuthorityReadBudget(),
    ),
  ).toBeNull();
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: input.subtitleId },
    }),
  ).toMatchObject({ state: "validated", path: null, version: 0 });
  f.files.context.checkpoint = () => Promise.resolve();
  await installMovieSubtitlesV4(f.files.context, input);
  expect(
    await readMovieSubtitleReceiptV4(
      f.db,
      input,
      new PublicationAuthorityReadBudget(),
    ),
  ).toMatchObject({
    after: { version: 1 },
    journal: { operationId: input.operationId, phase: "complete" },
  });
});

test("expiry during staging cannot renew the original invocation or publish a caption", async () => {
  const f = await fixture();
  const { input } = await selected(f);
  const execution = testPublicationExecution();
  let captures = 0;
  f.files.context.publicationExecution = () => {
    captures++;
    return execution;
  };
  f.files.context.checkpoint = (phase) => {
    if (phase === "staged")
      vi.spyOn(Date, "now").mockReturnValue(execution.observed.wall + 60_001);
    return Promise.resolve();
  };
  await expect(
    installMovieSubtitlesV4(f.files.context, input),
  ).rejects.toThrow();
  expect(captures).toBe(1);
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: input.subtitleId },
    }),
  ).toMatchObject({ state: "validated", path: null, version: 0 });
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(100);
  await expect(readMovieSubtitleReceiptV4(f.db, input, budget)).rejects.toThrow(
    "100 total queried records",
  );
});

test.each(["writer", "storage", "requester"] as const)(
  "renewing %s during staging cannot replace the original expiry",
  async (source) => {
    const f = await fixture();
    const { input } = await selected(f);
    const expiresAtMs = Date.now() + 10_000;
    if (source === "writer")
      await f.db.legacyWriterLease.update({
        where: { id: "singleton" },
        data: { expiresAt: new Date(expiresAtMs) },
      });
    if (source === "storage")
      await f.db.mediaStorageAuthority.update({
        where: { rootPath: "/data/movies" },
        data: { expiresAt: new Date(expiresAtMs) },
      });
    if (source === "requester")
      await f.db.plexIdentityMapping.update({
        where: { userId: f.result.subjectUserId },
        data: { verifiedAt: new Date(expiresAtMs - 300_000) },
      });
    let renewed = false;
    f.files.context.checkpoint = async (phase) => {
      if (phase !== "staged") return;
      if (source === "writer") await grantTestLease(f.db);
      if (source === "storage")
        await f.db.mediaStorageAuthority.update({
          where: { rootPath: "/data/movies" },
          data: {
            observedAt: new Date(),
            expiresAt: new Date(Date.now() + 90_000),
          },
        });
      if (source === "requester")
        await f.db.plexIdentityMapping.update({
          where: { userId: f.result.subjectUserId },
          data: { verifiedAt: new Date() },
        });
      renewed = true;
      vi.spyOn(Date, "now").mockReturnValue(expiresAtMs + 1);
    };
    await expect(
      installMovieSubtitlesV4(f.files.context, input),
    ).rejects.toThrow();
    expect(renewed).toBe(true);
    expect(
      await f.db.subtitleAsset.findUniqueOrThrow({
        where: { id: input.subtitleId },
      }),
    ).toMatchObject({ state: "validated", path: null, version: 0 });
    expect(
      await readMovieSubtitleReceiptV4(
        f.db,
        input,
        new PublicationAuthorityReadBudget(),
      ),
    ).toBeNull();
  },
);
