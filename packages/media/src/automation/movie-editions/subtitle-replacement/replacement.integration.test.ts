import { afterEach, beforeAll, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createMovieReplacementFixture } from "#testing/movie-workflow/subtitles/subtitle-replacement-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { replacementPaths } from "#automation/subtitle-replacement/files.ts";
import { readMovieReplacementReceiptV2 } from "#infrastructure/movie-editions/subtitle-replacement/records.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { findMoviePublicationReferenceV2 } from "#infrastructure/movie-editions/publication/store.ts";
import { createMovieSubtitleReplacementFileFacet } from "./facet.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";

const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
const hash = (input: Uint8Array) =>
  createHash("sha256").update(input).digest("hex");
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

test.each(MovieEditionKeySchema.options)(
  "actual %s owner replacement preserves original video, installation and serving authority",
  async (edition) => {
    const f = await createMovieReplacementFixture(edition, bytes);
    closers.push(f.close);
    const originalReceipts = await f.db.operation.findMany({
      where: {
        kind: {
          in: ["reconcile_movie_edition_v4", "acquire_movie_subtitles_v4"],
        },
      },
      orderBy: { id: "asc" },
    });
    const publication = await f.db.mediaPublicationTransition.findMany({
      orderBy: { id: "asc" },
    });
    const pointer = await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
    });
    const sibling = await f.db.subtitleAsset.findFirstOrThrow({
      where: {
        assetId: f.asset.id,
        language: "zh-Hans",
        state: "installed",
        storageKind: "sidecar",
      },
    });
    const originalBytes = await readFile(
      workerFilePath(f.source.files.context, f.asset.path),
    );
    const oldBytes = await readFile(
      workerFilePath(f.source.files.context, z.string().parse(f.old.path)),
    );
    const input = await f.approve();
    const applyBudget = new PublicationAuthorityReadBudget();
    const consume = applyBudget.consume.bind(applyBudget);
    const trace: string[] = [];
    applyBudget.consume = (count) => {
      const before = applyBudget.take - 1;
      const stack =
        new Error("Actual movie replacement provenance charge").stack ?? "";
      trace.push(
        `${String(before)} remaining, charge ${String(count)}\n${stack}`,
      );
      consume(count);
    };
    const applied = await createMovieSubtitleReplacementFileFacet(
      f.source.files.context,
    )("applySubtitleReplacement", input, {
      execution: testPublicationExecution(),
      budget: applyBudget,
    });
    expect(applied, trace.join("\n")).toEqual({
      state: "applied",
    });
    const row = await f.row();
    expect(row).toMatchObject({
      state: "applied",
      reservationActive: false,
      receipt: { outcome: "installed" },
    });
    const receipt = await readMovieReplacementReceiptV2(
      f.db,
      row.id,
      new PublicationAuthorityReadBudget(),
    );
    expect(receipt).toMatchObject({
      snapshot: {
        schemaVersion: 2,
        scope: f.scope,
        source: { kind: "installation_v4" },
      },
      receipt: {
        after: {
          candidate: { id: f.candidate.id, state: "installed", version: 1 },
        },
        journal: { kind: "import", phase: "complete" },
      },
    });
    const paths = replacementPaths(f.source.files.context, row);
    expect(hash(await readFile(paths.target))).toBe(hash(Buffer.from(f.text)));
    expect(hash(await readFile(paths.oldArchive))).toBe(hash(oldBytes));
    const video = await readFile(paths.video);
    expect(video.byteLength).toBe(originalBytes.byteLength);
    expect(hash(video)).toBe(hash(originalBytes));
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toEqual(f.asset);
    expect(
      await f.db.subtitleAsset.findUniqueOrThrow({ where: { id: sibling.id } }),
    ).toEqual(sibling);
    expect(
      await f.db.plexBindingCurrent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
      }),
    ).toEqual(pointer);
    expect(
      await f.db.operation.findMany({
        where: { id: { in: originalReceipts.map((command) => command.id) } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(originalReceipts);
    expect(
      await f.db.mediaPublicationTransition.findMany({
        orderBy: { id: "asc" },
      }),
    ).toEqual(publication);
    expect(await f.db.acquisitionAttempt.count()).toBe(1);
    expect(f.source.wire.additions()).toBe(1);
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
    expect(
      reference?.subtitleLineage?.installations.map((item) => item.subtitleId),
    ).toContain(f.candidate.id);
    const historical = createMovieSubtitleReplacementFileFacet({
      ...f.source.files.context,
      permittedMovieSection: () =>
        Promise.reject(
          new Error("Completed receipt precedes current configuration"),
        ),
      enabled: {
        ...f.source.files.context.enabled,
        acquisition: () =>
          Promise.reject(new Error("Completed receipt precedes current gates")),
      },
    });
    expect(
      await historical("applySubtitleReplacement", input, {
        execution: testPublicationExecution(),
        budget: new PublicationAuthorityReadBudget(),
      }),
    ).toEqual({ state: "applied" });
    expect(await f.row()).toEqual(row);
  },
  60_000,
);
