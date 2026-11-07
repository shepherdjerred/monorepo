import { afterEach, beforeAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { z } from "zod";
import { createMovieReplacementFixture } from "#testing/movie-workflow/subtitles/subtitle-replacement-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createMovieSubtitleReplacementFileFacet } from "./facet.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  replacementPaths,
  readReplacementJournal,
} from "#automation/subtitle-replacement/files.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { MovieReplacementReceiptV2Schema } from "#shared/movie-editions/subtitle-replacement-v2.ts";

let bytes: Uint8Array;
const closers: (() => Promise<void>)[] = [];
const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

test("a genuine cancelled choice after the actual native swap permits only receipt-owned caption compensation", async () => {
  const f = await createMovieReplacementFixture("directors_cut", bytes);
  closers.push(f.close);
  const input = await f.approve();
  const row = await f.row();
  const paths = replacementPaths(f.source.files.context, row);
  const old = await readFile(paths.target);
  const failure = new Error(
    "Synthetic Files interruption before actual caption receipt settlement",
  );
  await expect(
    createMovieSubtitleReplacementFileFacet({
      ...f.source.files.context,
      checkpoint: async (phase) => {
        if (phase === "subtitle-replacement-before-receipt") throw failure;
      },
    })("applySubtitleReplacement", input, {
      execution: testPublicationExecution(),
      budget: new PublicationAuthorityReadBudget(),
    }),
  ).rejects.toBe(failure);
  expect(hash(await readFile(paths.target))).toBe(hash(Buffer.from(f.text)));
  expect(hash(await readFile(paths.oldArchive))).toBe(hash(old));
  const finish = createOutboxActivities(f.db, () =>
    Promise.reject(new Error("Completion cannot dispatch")),
  );
  await finish.finishMediaOperation({
    operationId: f.prepareInput.operationId,
    status: "completed",
    reason: null,
  });
  await finish.finishMediaOperation({
    operationId: input.operationId,
    status: "reconciling",
    reason: "actual_caption_receipt_interrupted",
  });
  // This Media boundary test supplies Temporal's external descriptions. The role test uses native histories.
  const descriptions = new Map<
    string,
    { runId: string; status: "COMPLETED" | "FAILED" }
  >([
    [
      `media-operation-${f.prepareInput.operationId}`,
      { runId: crypto.randomUUID(), status: "COMPLETED" as const },
    ],
    [
      `media-operation-${input.operationId}`,
      { runId: crypto.randomUUID(), status: "FAILED" as const },
    ],
  ]);
  const described: string[] = [];
  f.describe.current = (id) => {
    described.push(id);
    return Promise.resolve(descriptions.get(id) ?? null);
  };
  const request = await f.db.mediaRequest.findUniqueOrThrow({
    where: {
      userId_mediaId_edition: {
        userId: f.source.user.id,
        mediaId: f.scope.mediaId,
        edition: f.scope.edition,
      },
    },
  });
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
    },
  });
  const sections = await f.source.context.permittedSections();
  await new MovieLifecycleCommands(f.db, {
    keepDays: 30,
    serverMachineId: z.string().min(1).parse(f.source.context.serverMachineId),
    movieSectionId: sections.movie,
  }).cancelMovieEditionRequest(f.source.user, crypto.randomUUID(), {
    schemaVersion: 3,
    action: "cancel_request",
    scope: f.scope,
    subjectUserId: f.source.user.id,
    requestId: request.id,
    expected: {
      targetVersion: target.version,
      requestVersion: request.version,
      choiceRevision: request.movieEditionChoiceRevision,
    },
  });
  const current = await f.row();
  const captionEvents = await f.db.applicationEvent.findMany({
    where: { kind: "subtitles_ready" },
    orderBy: { id: "asc" },
  });
  const immutable = await f.db.operation.findMany({
    where: { kind: "acquire_movie_subtitles_v4" },
    orderBy: { id: "asc" },
  });
  const command = await f.service.review.reconcile(
    f.owner,
    crypto.randomUUID(),
    row.id,
    { expectedVersion: current.version },
  );
  expect(described).toEqual([...descriptions.keys()]);
  const reconcile = {
    replacementId: row.id,
    operationId: z.uuid().parse(command.operationId),
    movieScope: f.scope,
  };
  expect(await f.invoke("reconcileSubtitleReplacement", reconcile)).toEqual({
    state: "rolled_back",
  });
  expect(hash(await readFile(paths.target))).toBe(hash(old));
  expect(hash(await readFile(paths.rejected))).toBe(hash(Buffer.from(f.text)));
  expect(hash(await readFile(paths.oldArchive))).toBe(hash(old));
  const targetIdentity = await lstat(paths.target, { bigint: true });
  const archiveIdentity = await lstat(paths.oldArchive, { bigint: true });
  expect({ device: targetIdentity.dev, inode: targetIdentity.ino }).toEqual({
    device: archiveIdentity.dev,
    inode: archiveIdentity.ino,
  });
  expect(targetIdentity.nlink).toBeGreaterThanOrEqual(2n);
  expect(hash(await readFile(paths.video))).toBe(hash(bytes));
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: f.old.id } }),
  ).toEqual(f.old);
  expect(
    await f.db.subtitleAsset.findUniqueOrThrow({
      where: { id: f.candidate.id },
    }),
  ).toMatchObject({ state: "failed", version: f.candidate.version + 1 });
  const settled = await f.row();
  expect(settled).toMatchObject({
    state: "rolled_back",
    reservationActive: false,
    receipt: { outcome: "compensated" },
    snapshot: row.snapshot,
  });
  const receipt = MovieReplacementReceiptV2Schema.parse(
    settled.receipt?.evidence,
  );
  expect(receipt.before.old).toEqual(receipt.after.old);
  expect(receipt.after.candidate.state).toBe("failed");
  expect(
    receipt.artifacts.find((artifact) => artifact.name === "oldArchive"),
  ).toMatchObject({
    identity: {
      checksum: hash(old),
      inode: archiveIdentity.ino.toString(),
      device: archiveIdentity.dev.toString(),
    },
  });
  expect(
    await readReplacementJournal(paths, row.importOperationId),
  ).toMatchObject({
    operationId: row.importOperationId,
    kind: "import",
    phase: "complete",
    source: paths.source,
    target: paths.target,
    sha256: f.candidate.checksum,
    previousSha256: f.old.checksum,
  });
  expect(
    await readReplacementJournal(paths, row.rollbackOperationId),
  ).toMatchObject({
    operationId: row.rollbackOperationId,
    kind: "rollback",
    phase: "complete",
    source: paths.oldArchive,
    target: paths.target,
    sha256: f.old.checksum,
    previousSha256: f.candidate.checksum,
  });
  expect(
    await f.db.operation.findMany({
      where: { kind: "acquire_movie_subtitles_v4" },
      orderBy: { id: "asc" },
    }),
  ).toEqual(immutable);
  expect(
    await f.db.applicationEvent.findMany({
      where: { kind: "subtitles_ready" },
      orderBy: { id: "asc" },
    }),
  ).toEqual(captionEvents);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toEqual(f.asset);
  expect(f.source.wire.additions()).toBe(1);
}, 60_000);
