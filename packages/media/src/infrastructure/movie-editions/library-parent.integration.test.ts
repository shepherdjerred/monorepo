import { afterAll, beforeAll, expect, test } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { adoptedMovieFixture } from "#testing/library-movie.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { snapshotMoviePublicationAssetV2 } from "./publication/snapshot.ts";
import { findMoviePublicationReferenceV2 } from "./publication/store.ts";
import { loadMovieLibraryParentV2 } from "./library-records.ts";
import { loadLibraryAssetParentV1 } from "#infrastructure/handoff/library-asset.ts";
import { libraryPlexPhysicalGroup } from "#infrastructure/plex-binding/library/authority.ts";
import { readPlexPhysicalGroup } from "#infrastructure/plex-binding/read.ts";
import { queueMovieSubtitleTargetsV4 } from "#automation/movie-editions/subtitles/queue.ts";
import { findMovieSubtitlesV4 } from "#automation/movie-editions/subtitles/network.ts";
import { installMovieSubtitlesV4 } from "#automation/files/movie-editions/subtitles.ts";
import { fromOpenSubtitles } from "#automation/subtitle-sources.ts";
import { MovieSubtitleOperationV4Schema } from "#shared/movie-editions/subtitles-v4.ts";
import { readMovieSubtitleReceiptV4 } from "./subtitle-receipt.ts";
import { subtitleDestination } from "#domain/subtitle-path.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
let bytes: Uint8Array;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  bytes = await movieVideoFixture();
}, 60_000);
afterAll(async () => {
  await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test.each(MovieEditionKeySchema.options)(
  "an actually adopted %s file supplies its immutable parent without an acquisition history",
  async (edition) => {
    const f = await adoptedMovieFixture(
      cluster.database,
      { bytes, edition },
      (directory) => directories.push(directory),
    );
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
    expect(reference).toMatchObject({
      kind: "movie_library_adoption_v2",
      scope: f.scope,
      receiptId: f.receiptId,
      assetId: f.asset.id,
      assetVersion: 0,
    });
    expect(
      await f.db.acquisitionAttempt.count({
        where: { mediaIds: { has: f.scope.mediaId } },
      }),
    ).toBe(0);
    await f.db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: {
        mode: "observe",
        ownershipConfirmed: false,
        version: { increment: 1 },
      },
    });
    const original = await loadMovieLibraryParentV2(
      f.db,
      { receiptId: f.receiptId, assetId: f.asset.id },
      new PublicationAuthorityReadBudget(),
    );
    expect(original.reference).toEqual(reference);
    const servingParent = await loadLibraryAssetParentV1(
      f.db,
      { receiptId: f.receiptId, assetId: f.asset.id },
      new PublicationAuthorityReadBudget(),
    );
    expect(servingParent.asset).toEqual(original.asset);
    expect(servingParent.reference).toMatchObject({
      kind: "library_adoption_v1",
      receiptId: f.receiptId,
      assetId: f.asset.id,
      bindingHash: original.reference.bindingHash,
    });
    await expect(
      loadLibraryAssetParentV1(
        f.db,
        { receiptId: f.receiptId, assetId: crypto.randomUUID() },
        new PublicationAuthorityReadBudget(),
      ),
    ).rejects.toThrow("exact selected file");
    const spent = new PublicationAuthorityReadBudget();
    spent.consume(99);
    await expect(
      loadLibraryAssetParentV1(
        f.db,
        { receiptId: f.receiptId, assetId: f.asset.id },
        spent,
      ),
    ).rejects.toThrow("100 total queried records");
    const otherScope = {
      ...f.scope,
      edition:
        edition === "directors_cut"
          ? ("theatrical_cut" as const)
          : ("directors_cut" as const),
    };
    await expect(
      findMoviePublicationReferenceV2(
        f.db,
        { scope: otherScope, asset },
        new PublicationAuthorityReadBudget(),
      ),
    ).rejects.toThrow("another edition");
  },
);

test("initial library parent reads preserve the caller's single allowance", async () => {
  const f = await adoptedMovieFixture(
    cluster.database,
    { bytes, edition: "final_cut" },
    (directory) => directories.push(directory),
  );
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  await expect(
    loadMovieLibraryParentV2(
      f.db,
      { receiptId: f.receiptId, assetId: f.asset.id },
      budget,
    ),
  ).rejects.toThrow("100 total queried records");
});

async function provider(f: Awaited<ReturnType<typeof adoptedMovieFixture>>) {
  const credential = await f.db.credential.create({
    data: {
      kind: "provider",
      ciphertext: f.networkContext.cipher.encrypt(
        JSON.stringify({
          apiKey: "fixture",
          userAgent: "fixture",
          username: "fixture",
          password: "fixture",
        }),
        "provider:opensubtitles",
      ),
    },
  });
  await f.db.mediaProvider.upsert({
    where: { id: "opensubtitles" },
    create: { id: "opensubtitles", enabled: true, credentialId: credential.id },
    update: { enabled: true, credentialId: credential.id },
  });
  await f.db.providerLease.deleteMany({
    where: { providerId: "opensubtitles" },
  });
  const filename = `${path.basename(z.string().parse(f.asset.sourcePath), ".mkv")}.srt`;
  return {
    opensubtitles: (
      context: typeof f.networkContext,
      query: Parameters<typeof fromOpenSubtitles>[1],
    ) =>
      fromOpenSubtitles(context, query, (url) => {
        if (url.pathname.endsWith("/login"))
          return Promise.resolve(Response.json({ token: "fixture" }));
        if (url.pathname.endsWith("/subtitles"))
          return Promise.resolve(
            Response.json({
              total_pages: 1,
              data: [
                {
                  id: "1",
                  attributes: {
                    language: "en",
                    release: "human",
                    ai_translated: false,
                    machine_translated: false,
                    foreign_parts_only: false,
                    hearing_impaired: false,
                    files: [{ file_id: 1, file_name: filename }],
                  },
                },
              ],
            }),
          );
        if (url.pathname.endsWith("/download"))
          return Promise.resolve(
            Response.json({
              link: "https://dl.opensubtitles.com/library.srt",
              file_name: filename,
            }),
          );
        if (url.hostname === "dl.opensubtitles.com")
          return Promise.resolve(
            new Response(
              "1\n00:00:00,000 --> 00:00:01,000\nA human caption for this actual library file\n",
            ),
          );
        throw new Error("Unexpected library caption provider request");
      }),
  };
}

test.each(MovieEditionKeySchema.options)(
  "an adopted %s file installs policy captions through its real library parent and retains the completed acknowledgement",
  async (edition) => {
    const f = await adoptedMovieFixture(
      cluster.database,
      { bytes, edition },
      (directory) => directories.push(directory),
    );
    expect(
      await f.db.$transaction((tx) =>
        queueMovieSubtitleTargetsV4(tx, {
          scope: f.scope,
          assetId: f.asset.id,
          epoch: 0,
          access: { serverMachineId: "fixture-server", movieSectionId: "1" },
        }),
      ),
    ).toBe(1);
    const row = await f.db.operation.findFirstOrThrow({
      where: { kind: "acquire_movie_subtitles_v4", targetId: f.asset.id },
    });
    const target = MovieSubtitleOperationV4Schema.parse(
      z.object(MovieSubtitleOperationV4Schema.shape).parse(row.payload),
    );
    const found = await findMovieSubtitlesV4(
      f.networkContext,
      target,
      await provider(f),
    );
    expect(found).toMatchObject({ status: "found", reason: null });
    const input = {
      schemaVersion: 4 as const,
      operationId: target.operationId,
      scope: f.scope,
      assetId: f.asset.id,
      subtitleId: z.uuid().parse(found.subtitleId),
    };
    await installMovieSubtitlesV4(f.context.files, input);
    const receipt = await readMovieSubtitleReceiptV4(
      f.db,
      input,
      new PublicationAuthorityReadBudget(),
    );
    expect(receipt).toMatchObject({
      publication: {
        kind: "movie_library_adoption_v2",
        receiptId: f.receiptId,
      },
      after: { state: "installed", version: 1 },
    });
    const installed = subtitleDestination({
      videoPath: f.target,
      language: "en",
      forced: false,
      hearingImpaired: false,
      format: "srt",
    });
    expect(await readFile(installed, "utf8")).toContain(
      "A human caption for this actual library file",
    );
    const budget = new PublicationAuthorityReadBudget();
    const current = await snapshotMoviePublicationAssetV2(
      f.db,
      f.scope,
      f.asset.id,
      budget,
    );
    const physical = await findMoviePublicationReferenceV2(
      f.db,
      { scope: f.scope, asset: current },
      budget,
    );
    expect(physical?.subtitleLineage?.installations).toHaveLength(1);
    const originalVideo = await loadLibraryAssetParentV1(
      f.db,
      { receiptId: f.receiptId, assetId: f.asset.id },
      budget,
    );
    const servingVideo = await readPlexPhysicalGroup(f.db, f.asset.id);
    expect(current.version).toBe(originalVideo.asset.version);
    expect(servingVideo.group).toEqual(libraryPlexPhysicalGroup(originalVideo));
    f.context.files.enabled.acquisition = () => Promise.resolve(false);
    await expect(
      installMovieSubtitlesV4(f.context.files, input),
    ).resolves.toBeUndefined();
    expect(
      await f.db.acquisitionAttempt.count({
        where: { mediaIds: { has: f.scope.mediaId } },
      }),
    ).toBe(0);
  },
);
