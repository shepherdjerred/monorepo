import { afterEach, beforeAll, expect, test } from "vitest";
import {
  access,
  readFile,
  readdir,
  mkdtemp,
  rm,
  realpath,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { createMovieReplacementFixture } from "#testing/movie-workflow/subtitles/subtitle-replacement-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { replacementPaths } from "#automation/subtitle-replacement/files.ts";
import { createMovieSubtitleReplacementFileFacet } from "./facet.ts";
import { safePath } from "#filesystem/operations-io.ts";

let bytes: Uint8Array;
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

test("cancellation during actual storage attestation cannot create new caption source bytes, staging or a native journal", async () => {
  const f = await createMovieReplacementFixture("directors_cut", bytes);
  closers.push(f.close);
  const input = await f.approve();
  const row = await f.row();
  const paths = replacementPaths(f.source.files.context, row);
  const original = await readFile(paths.target);
  const journalNames = await readdir(path.join(paths.roots.control, "journal"));
  const captions = await f.db.subtitleAsset.findMany({
    where: { assetId: f.asset.id },
    orderBy: { id: "asc" },
  });
  const cancellation = new AbortController();
  const execution = testPublicationExecution();
  const failure = new Error(
    "Synthetic original SDK cancellation during actual storage attestation",
  );
  let attestations = 0;
  const facet = createMovieSubtitleReplacementFileFacet({
    ...f.source.files.context,
    verifyStorageAuthority: async (roots) => {
      await f.source.files.context.verifyStorageAuthority(roots);
      attestations++;
      cancellation.abort(failure);
    },
  });
  const budget = new PublicationAuthorityReadBudget();
  await expect(
    facet("applySubtitleReplacement", input, {
      budget,
      execution: {
        ...execution,
        signal: cancellation.signal,
        assertActive: () => {
          execution.assertActive();
          cancellation.signal.throwIfAborted();
        },
      },
    }),
  ).rejects.toBe(failure);
  expect(attestations).toBe(1);
  expect(budget.take).toBeLessThan(101);
  expect(() => budget.consume(0)).not.toThrow();
  expect(await f.row()).toEqual(row);
  expect(
    await f.db.subtitleAsset.findMany({
      where: { assetId: f.asset.id },
      orderBy: { id: "asc" },
    }),
  ).toEqual(captions);
  expect(
    await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toEqual(f.asset);
  expect(await readdir(path.join(paths.roots.control, "journal"))).toEqual(
    journalNames,
  );
  for (const filename of [
    paths.source,
    paths.staged,
    paths.partial,
    paths.oldArchive,
    paths.rejected,
    paths.rollbackStaged,
  ])
    await expect(access(filename)).rejects.toMatchObject({ code: "ENOENT" });
  expect(hash(await readFile(paths.target))).toBe(hash(original));
  const video = await readFile(paths.video);
  expect({ size: video.byteLength, checksum: hash(video) }).toEqual({
    size: bytes.byteLength,
    checksum: hash(bytes),
  });
}, 60_000);

test("actual safe-path traversal checks the original SDK again immediately before creating a control parent", async () => {
  const allocated = await mkdtemp(
    path.join(tmpdir(), "movie-caption-sdk-parent-"),
  );
  const directory = await realpath(allocated);
  const cancellation = new AbortController();
  const original = testPublicationExecution();
  const execution = {
    ...original,
    signal: cancellation.signal,
    assertActive: () => {
      original.assertActive();
      cancellation.signal.throwIfAborted();
    },
  };
  const failure = new Error(
    "Synthetic original SDK cancellation at the actual control-directory effect boundary",
  );
  let mutations = 0;
  try {
    execution.assertActive();
    await expect(
      safePath(directory, "new-control-parent/candidate.srt", true, () => {
        mutations++;
        cancellation.abort(failure);
        execution.assertActive();
      }),
    ).rejects.toBe(failure);
    expect(mutations).toBe(1);
    expect(await readdir(directory)).toEqual([]);
    await expect(
      access(path.join(directory, "new-control-parent")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
