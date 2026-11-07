import { afterEach, beforeAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createMovieReplacementFixture } from "#testing/movie-workflow/subtitles/subtitle-replacement-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { replacementPaths } from "#automation/subtitle-replacement/files.ts";
import { createMovieSubtitleReplacementFileFacet } from "./facet.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
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

async function ready() {
  const f = await createMovieReplacementFixture("directors_cut", bytes);
  closers.push(f.close);
  const input = await f.approve();
  return {
    f,
    input,
    paths: replacementPaths(f.source.files.context, await f.row()),
  };
}

type Fixture = Awaited<ReturnType<typeof ready>>["f"];
async function unchangedParents(f: Fixture) {
  return {
    asset: await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
    }),
    captions: await f.db.subtitleAsset.findMany({
      where: { assetId: f.asset.id },
      orderBy: { id: "asc" },
    }),
    publications: await f.db.mediaPublicationTransition.findMany({
      orderBy: { id: "asc" },
    }),
    sourceCommands: await f.db.operation.findMany({
      where: {
        kind: {
          in: ["reconcile_movie_edition_v4", "acquire_movie_subtitles_v4"],
        },
      },
      orderBy: { id: "asc" },
    }),
    pointer: await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
    }),
  };
}

test("actual completed replacement journal survives a receipt-boundary failure and a fresh Activity acknowledges the same swap", async () => {
  const { f, input, paths } = await ready();
  const before = await unchangedParents(f);
  const row = await f.row();
  const video = await readFile(paths.video);
  const old = await readFile(paths.target);
  const failure = new Error(
    "Synthetic interruption after the actual native caption swap",
  );
  let interrupted = false;
  const first = createMovieSubtitleReplacementFileFacet({
    ...f.source.files.context,
    checkpoint: async (phase) => {
      if (phase === "subtitle-replacement-before-receipt") {
        interrupted = true;
        throw failure;
      }
    },
  });
  await expect(
    first("applySubtitleReplacement", input, {
      execution: testPublicationExecution(),
      budget: new PublicationAuthorityReadBudget(),
    }),
  ).rejects.toBe(failure);
  expect(interrupted).toBe(true);
  expect(await unchangedParents(f)).toEqual(before);
  const interruptedRow = await f.row();
  expect(interruptedRow).toMatchObject({
    state: "applying",
    reservationActive: true,
    receipt: null,
    snapshot: row.snapshot,
    snapshotHash: row.snapshotHash,
  });
  expect(interruptedRow.executionEvidence).not.toBeNull();
  expect(hash(await readFile(paths.target))).toBe(hash(Buffer.from(f.text)));
  expect(hash(await readFile(paths.oldArchive))).toBe(hash(old));
  const journalPath = path.join(
    paths.roots.control,
    "journal",
    `${row.importOperationId}.json`,
  );
  const raw = await readFile(journalPath, "utf8");
  expect(ManifestSchema.parse(JSON.parse(raw))).toMatchObject({
    operationId: row.importOperationId,
    kind: "import",
    phase: "complete",
    source: paths.source,
    target: paths.target,
    sha256: f.candidate.checksum,
    previousSha256: f.old.checksum,
  });
  let repeated = 0;
  const retry = createMovieSubtitleReplacementFileFacet({
    ...f.source.files.context,
    checkpoint: async (phase) => {
      if (phase === "previous-version-preserved" || phase === "published")
        repeated++;
    },
  });
  const budget = new PublicationAuthorityReadBudget();
  expect(
    await retry("applySubtitleReplacement", input, {
      execution: testPublicationExecution(),
      budget,
    }),
  ).toEqual({ state: "applied" });
  expect(repeated).toBe(0);
  expect(() => budget.consume(0)).not.toThrow();
  expect(await readFile(journalPath, "utf8")).toBe(raw);
  const afterVideo = await readFile(paths.video);
  expect({ size: afterVideo.byteLength, checksum: hash(afterVideo) }).toEqual({
    size: video.byteLength,
    checksum: hash(video),
  });
  expect(hash(await readFile(paths.target))).toBe(hash(Buffer.from(f.text)));
  expect(hash(await readFile(paths.oldArchive))).toBe(hash(old));
  const settled = await f.row();
  expect(settled).toMatchObject({
    state: "applied",
    reservationActive: false,
    receipt: { outcome: "installed" },
  });
  const receipt = MovieReplacementReceiptV2Schema.parse(
    settled.receipt?.evidence,
  );
  expect(receipt.after.candidate).toMatchObject({
    id: f.candidate.id,
    state: "installed",
    matchingEvidence: {
      movieReplacementV2: { schemaVersion: 2, replacementId: row.id },
    },
  });
  expect(
    await f.db.subtitleReplacementReceipt.count({
      where: { replacementId: row.id },
    }),
  ).toBe(1);
  const after = await unchangedParents(f);
  expect(after.asset).toEqual(before.asset);
  expect(after.publications).toEqual(before.publications);
  expect(after.sourceCommands).toEqual(before.sourceCommands);
  expect(after.pointer).toEqual(before.pointer);
  expect(
    after.captions.filter(
      (caption) => caption.id !== f.old.id && caption.id !== f.candidate.id,
    ),
  ).toEqual(
    before.captions.filter(
      (caption) => caption.id !== f.old.id && caption.id !== f.candidate.id,
    ),
  );
  expect(f.source.wire.additions()).toBe(1);
}, 60_000);

test("the actual original 99-spent caption allowance protects before native effects without a replacement receipt", async () => {
  const { f, input, paths } = await ready();
  const before = await unchangedParents(f);
  const row = await f.row();
  const target = await readFile(paths.target);
  const journalNames = await readdir(path.join(paths.roots.control, "journal"));
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  expect(
    await createMovieSubtitleReplacementFileFacet(f.source.files.context)(
      "applySubtitleReplacement",
      input,
      { execution: testPublicationExecution(), budget },
    ),
  ).toEqual({
    state: "protected",
    reason: "archive_transition_reconciliation_required",
  });
  expect(() => budget.consume(0)).toThrow("100 total queried records");
  expect(await unchangedParents(f)).toEqual(before);
  expect(await f.row()).toEqual(row);
  expect(hash(await readFile(paths.target))).toBe(hash(target));
  expect(await readdir(path.join(paths.roots.control, "journal"))).toEqual(
    journalNames,
  );
  await expect(access(paths.oldArchive)).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(access(paths.source)).rejects.toMatchObject({ code: "ENOENT" });
}, 60_000);

test("actual restored video captions use their immutable restore baseline before the reviewed same-path swap", async () => {
  const f = await createMovieReplacementFixture("extended_cut", bytes, {
    restored: true,
  });
  closers.push(f.close);
  const original = await unchangedParents(f);
  const restore = await f.db.operation.findMany({
    where: { kind: "restore_movie_edition_v4" },
    orderBy: { id: "asc" },
  });
  const quarantine = await f.db.operation.findMany({
    where: { kind: "retain_movie_edition_v4" },
    orderBy: { id: "asc" },
  });
  const input = await f.approve();
  expect(await f.invoke("applySubtitleReplacement", input)).toEqual({
    state: "applied",
  });
  const row = await f.row();
  const receipt = MovieReplacementReceiptV2Schema.parse(row.receipt?.evidence);
  expect(receipt.source).toMatchObject({
    kind: "video_baseline",
    publication: {
      kind: "movie_restore_publication_v1",
      scope: f.scope,
      assetId: f.asset.id,
      assetVersion: f.asset.version,
    },
  });
  expect(receipt.before.old).toMatchObject({
    id: f.old.id,
    videoVersion: f.asset.version,
  });
  expect(
    await f.db.operation.findMany({
      where: { kind: "restore_movie_edition_v4" },
      orderBy: { id: "asc" },
    }),
  ).toEqual(restore);
  expect(
    await f.db.operation.findMany({
      where: { kind: "retain_movie_edition_v4" },
      orderBy: { id: "asc" },
    }),
  ).toEqual(quarantine);
  const after = await unchangedParents(f);
  expect(after.asset).toEqual(original.asset);
  expect(after.sourceCommands).toEqual(original.sourceCommands);
  expect(after.publications).toEqual(original.publications);
  expect(after.pointer).toEqual(original.pointer);
  const paths = replacementPaths(f.source.files.context, row);
  expect(hash(await readFile(paths.target))).toBe(hash(Buffer.from(f.text)));
  expect(hash(await readFile(paths.video))).toBe(hash(bytes));
}, 60_000);
