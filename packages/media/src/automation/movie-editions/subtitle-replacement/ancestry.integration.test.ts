import { afterEach, beforeAll, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createMovieReplacementFixture } from "#testing/movie-workflow/subtitles/subtitle-replacement-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { MovieReplacementReceiptV2Schema } from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { findMoviePublicationReferenceV2 } from "#infrastructure/movie-editions/publication/store.ts";
import { replacementPaths } from "#automation/subtitle-replacement/files.ts";
import { createMovieSubtitleReplacementFileFacet } from "./facet.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";

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

test("a second actual reviewed swap pins the first literal receipt hash and preserves the full installation ancestry", async () => {
  const f = await createMovieReplacementFixture("directors_cut", bytes);
  closers.push(f.close);
  expect(await f.invoke("applySubtitleReplacement", await f.approve())).toEqual(
    { state: "applied" },
  );
  const first = await f.row();
  const previous = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: f.candidate.id },
  });
  const firstReceipt = MovieReplacementReceiptV2Schema.parse(
    first.receipt?.evidence,
  );
  const firstEvent = await f.db.applicationEvent.findUniqueOrThrow({
    where: { dedupeKey: `movie-subtitle-replaced-v2:${first.id}` },
  });
  const text =
    "1\n00:00:00,000 --> 00:00:01,500\nA second owner-verified correction with its own human bytes.\n";
  const uploaded = await f.service.upload(f.owner, crypto.randomUUID(), {
    schemaVersion: 2,
    scope: f.scope,
    assetId: f.asset.id,
    expectedAssetVersion: f.asset.version,
    expectedChecksum: z.string().parse(f.asset.checksum),
    language: "en",
    forced: z.boolean().parse(previous.forced),
    hearingImpaired: z.boolean().parse(previous.hearingImpaired),
    filename: "second-correction.srt",
    description: "Second actual owner correction for this exact cut",
    contentBase64: Buffer.from(text).toString("base64"),
    declaredEncoding: "utf8",
    confirmedMatchingVideo: true,
    replacementFor: {
      oldSubtitleId: previous.id,
      expectedOldVersion: previous.version,
    },
  });
  const candidate = await f.db.subtitleAsset.findUniqueOrThrow({
    where: { id: z.uuid().parse(uploaded.subtitleId) },
  });
  const prepared = await f.service.prepare(f.owner, crypto.randomUUID(), {
    schemaVersion: 2,
    scope: f.scope,
    oldSubtitleId: previous.id,
    candidateSubtitleId: candidate.id,
    expectedOldVersion: previous.version,
    expectedCandidateVersion: candidate.version,
  });
  const replacementId = z.uuid().parse(prepared.subtitleReplacementId);
  expect(
    await f.invoke("prepareSubtitleReplacement", {
      replacementId,
      operationId: z.uuid().parse(prepared.operationId),
      movieScope: f.scope,
    }),
  ).toEqual({ state: "ready" });
  const ready = await f.db.subtitleReplacement.findUniqueOrThrow({
    where: { id: replacementId },
    include: { review: true },
  });
  const command = await f.service.review.apply(
    f.owner,
    crypto.randomUUID(),
    replacementId,
    {
      expectedVersion: ready.version,
      observationHash: z.string().parse(ready.review?.observationHash),
      acknowledgeReplacement: true,
    },
  );
  const allowance = new PublicationAuthorityReadBudget();
  const consume = allowance.consume.bind(allowance);
  const trace: string[] = [];
  allowance.consume = (count) => {
    trace.push(
      `${String(allowance.take - 1)} remaining; charge ${String(count)}\n${new Error("Actual second replacement read").stack ?? ""}`,
    );
    consume(count);
  };
  const result = await createMovieSubtitleReplacementFileFacet(
    f.source.files.context,
  )(
    "applySubtitleReplacement",
    {
      replacementId,
      operationId: z.uuid().parse(command.operationId),
      movieScope: f.scope,
    },
    { execution: testPublicationExecution(), budget: allowance },
  );
  expect(result, trace.join("\n")).toEqual({ state: "applied" });
  const second = await f.db.subtitleReplacement.findUniqueOrThrow({
    where: { id: replacementId },
    include: { receipt: true },
  });
  const receipt = MovieReplacementReceiptV2Schema.parse(
    second.receipt?.evidence,
  );
  expect(receipt.source).toEqual({
    kind: "replacement_v2",
    replacementId: first.id,
    receiptId: first.receipt?.id,
    receiptHash: identityHash(firstReceipt),
  });
  expect(receipt.before.old).toEqual(firstReceipt.after.candidate);
  expect(await f.row()).toEqual(first);
  expect(
    await f.db.applicationEvent.findUniqueOrThrow({
      where: { id: firstEvent.id },
    }),
  ).toEqual(firstEvent);
  expect(
    JSON.parse(
      z.object({ receiptRaw: z.string() }).parse(firstEvent.payload).receiptRaw,
    ),
  ).toEqual(firstReceipt);
  const paths = replacementPaths(f.source.files.context, second);
  expect(hash(await readFile(paths.target))).toBe(hash(Buffer.from(text)));
  expect(hash(await readFile(paths.oldArchive))).toBe(
    hash(Buffer.from(f.text)),
  );
  expect(hash(await readFile(paths.video))).toBe(hash(bytes));
  const budget = new PublicationAuthorityReadBudget();
  const asset = await snapshotMoviePublicationAssetV2(
    f.db,
    f.scope,
    f.asset.id,
    budget,
  );
  const reference = await findMoviePublicationReferenceV2(
    f.db,
    { scope: f.scope, asset },
    budget,
  );
  const installation = reference?.subtitleLineage?.installations.find(
    (item) => item.subtitleId === candidate.id,
  );
  expect(installation?.journals.map((journal) => journal.operationId)).toEqual([
    z
      .object({ movieInstallationV4: z.object({ operationId: z.uuid() }) })
      .parse(f.old.matchingEvidence).movieInstallationV4.operationId,
    first.importOperationId,
    second.importOperationId,
  ]);
  expect(() => budget.consume(0)).not.toThrow();
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toEqual(f.asset);
  expect(f.source.wire.additions()).toBe(1);
}, 60_000);
