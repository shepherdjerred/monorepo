import { afterEach, beforeAll, expect, test } from "vitest";
import { access, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { createMovieReplacementFixture } from "#testing/movie-workflow/subtitles/subtitle-replacement-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { replacementPaths } from "#automation/subtitle-replacement/files.ts";
import { createMovieSubtitleReplacementFileFacet } from "./facet.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";

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

test.each(["scope", "choice", "sdk"] as const)(
  "a changed actual %s cannot publish a named movie replacement or change its source receipts",
  async (change) => {
    const f = await createMovieReplacementFixture("directors_cut", bytes);
    closers.push(f.close);
    const input = await f.approve();
    const row = await f.row();
    const paths = replacementPaths(f.source.files.context, row);
    const old = await readFile(paths.target);
    const captions = await f.db.subtitleAsset.findMany({
      where: { assetId: f.asset.id },
      orderBy: { id: "asc" },
    });
    const publication = await f.db.mediaPublicationTransition.findMany({
      orderBy: { id: "asc" },
    });
    const operations = await f.db.operation.findMany({
      where: { kind: "acquire_movie_subtitles_v4" },
      orderBy: { id: "asc" },
    });
    const journals = await readdir(path.join(paths.roots.control, "journal"));
    if (change === "choice")
      await requestTestMovieV4(
        f.db,
        f.source.user,
        f.scope.mediaId,
        f.scope.edition,
      );
    const execution = testPublicationExecution();
    const cancellation = new AbortController();
    const original = {
      ...execution,
      signal: cancellation.signal,
      assertActive: () => {
        execution.assertActive();
        cancellation.signal.throwIfAborted();
      },
    };
    let authorized = false;
    let journalAtCancellation: string | undefined;
    let stagedAtCancellation: string | undefined;
    const afterCancellation: string[] = [];
    const failure = new Error(
      "Synthetic original SDK cancellation before the native replacement syscall",
    );
    const facet = createMovieSubtitleReplacementFileFacet({
      ...f.source.files.context,
      checkpoint: async (phase) => {
        if (cancellation.signal.aborted) afterCancellation.push(phase);
        if (change === "sdk" && phase === "subtitle-replacement-authorized") {
          authorized = true;
          journalAtCancellation = await readFile(
            path.join(
              paths.roots.control,
              "journal",
              `${row.importOperationId}.json`,
            ),
            "utf8",
          );
          stagedAtCancellation = hash(await readFile(paths.staged));
          cancellation.abort(failure);
        }
      },
    });
    const effect = facet(
      "applySubtitleReplacement",
      change === "scope"
        ? { ...input, movieScope: { ...f.scope, edition: "extended_cut" } }
        : input,
      { execution: original, budget: new PublicationAuthorityReadBudget() },
    );
    if (change === "choice")
      expect(await effect).toMatchObject({ state: "protected" });
    else if (change === "sdk") await expect(effect).rejects.toBe(failure);
    else
      await expect(effect).rejects.toMatchObject({
        reason: "subtitle_replacement_operation_changed",
      });
    expect(authorized).toBe(change === "sdk");
    expect(hash(await readFile(paths.target))).toBe(hash(old));
    const video = await readFile(paths.video);
    expect({ size: video.byteLength, checksum: hash(video) }).toEqual({
      size: bytes.byteLength,
      checksum: hash(bytes),
    });
    expect(
      await f.db.subtitleAsset.findMany({
        where: { assetId: f.asset.id },
        orderBy: { id: "asc" },
      }),
    ).toEqual(captions);
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toEqual(f.asset);
    expect(
      await f.db.mediaPublicationTransition.findMany({
        orderBy: { id: "asc" },
      }),
    ).toEqual(publication);
    expect(
      await f.db.operation.findMany({
        where: { kind: "acquire_movie_subtitles_v4" },
        orderBy: { id: "asc" },
      }),
    ).toEqual(operations);
    const afterJournals = await readdir(
      path.join(paths.roots.control, "journal"),
    );
    if (change === "sdk") {
      expect(afterCancellation).toEqual([]);
      expect(afterJournals.sort()).toEqual(
        [...journals, `${row.importOperationId}.json`].sort(),
      );
      const raw = await readFile(
        path.join(
          paths.roots.control,
          "journal",
          `${row.importOperationId}.json`,
        ),
        "utf8",
      );
      expect(raw).toBe(journalAtCancellation);
      expect(ManifestSchema.parse(JSON.parse(raw))).toMatchObject({
        operationId: row.importOperationId,
        kind: "import",
        phase: "staged",
        source: paths.source,
        target: paths.target,
        sha256: f.candidate.checksum,
        previousSha256: f.old.checksum,
      });
      expect(hash(await readFile(paths.staged))).toBe(stagedAtCancellation);
      expect(stagedAtCancellation).toBe(hash(Buffer.from(f.text)));
    } else expect(afterJournals).toEqual(journals);
    await expect(access(paths.oldArchive)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await f.row()).toMatchObject({
      receipt: null,
      reservationActive: true,
      snapshot: row.snapshot,
      snapshotHash: row.snapshotHash,
    });
  },
  60_000,
);
