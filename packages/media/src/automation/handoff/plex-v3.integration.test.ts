import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { rm, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { libraryPlexFixture } from "./plex-edit-fixture.ts";
import { prepareHandoffFiles } from "./files.ts";
import { finishHandoffPreparation } from "./plan.ts";
import {
  PrepareLibraryHandoffV3Schema,
  FinishedLibraryHandoffV3Schema,
  LibraryPlexFileProofV1Schema,
} from "#shared/handoff/library-v3.ts";
import { prepareLibraryPlexEditFileV3 } from "./plex-edit-files.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { editLibraryPlexEditionV3 } from "./plex-edit-network.ts";
import { bindingTestExecution } from "#automation/plex-binding/test-fixture.ts";
import { PlexEditionCompletionV1Schema } from "#shared/handoff/plex-edition.ts";
import { applyPreparedHandoff } from "./apply.ts";
import { loadMovieLibraryParentV2 } from "#infrastructure/movie-editions/library-records.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function fixture(edition: MovieEditionKey, classify?: "from_filename") {
  const f = await libraryPlexFixture(
    cluster.database,
    edition,
    classify === undefined ? {} : { classify },
  );
  directories.push(f.directory);
  return f;
}

test.each(MovieEditionKeySchema.options)(
  "v3 prepares an exact %s label correction without editing Plex or owning a file",
  async (edition) => {
    const f = await fixture(edition);
    await f.observe();
    const prepared = await prepareHandoffFiles(f.context, f.planId);
    // Playback can advance while hashing; it is retained in observations, not frozen as future write authority.
    f.setItem({ ...f.item(), viewCount: 4, viewOffset: 0 });
    await f.observe();
    await finishHandoffPreparation(cluster.database, f.planId, prepared);
    const detail = await f.commands.detail(f.network.actor, f.planId);
    const plan = FinishedLibraryHandoffV3Schema.parse(detail.plan);
    expect(plan.plexEdits).toMatchObject([
      {
        assetId: prepared.scope.files[0]?.assetId,
        beforeEditionTitle: "Incorrect label",
        targetEditionTitle: MOVIE_EDITION_REGISTRY[edition].plexLabel,
      },
    ]);
    const network = z
      .object({
        plex: z.array(
          z.object({ movieEdition: z.object({ identityHash: z.string() }) }),
        ),
      })
      .parse(plan.network);
    expect(network.plex[0]?.movieEdition).not.toHaveProperty("watch");
    expect(f.item().editionTitle).toBe("Incorrect label");
    expect(
      await cluster.database.libraryAsset.findUnique({
        where: { path: f.target },
      }),
    ).toBeNull();
    expect(await readFile(f.target, "utf8")).toBe(f.bytes);
  },
);

test("a real v3 approval produces a fresh immutable file proof without owning or editing the movie", async () => {
  const f = await fixture("directors_cut");
  const ready = await f.ready();
  const assetId = z.uuid().parse(ready.prepared.scope.files[0]?.assetId);
  const reference = await prepareLibraryPlexEditFileV3(
    f.context,
    { schemaVersion: 3, ...ready.input, assetId },
    testPublicationExecution(),
  );
  const row = await cluster.database.mediaHandoffObservation.findUniqueOrThrow({
    where: { id: reference.id },
  });
  expect(row.evidenceHash).toBe(reference.evidenceHash);
  expect(LibraryPlexFileProofV1Schema.parse(row.evidence)).toMatchObject({
    schemaVersion: 1,
    planId: f.planId,
    operationId: ready.input.operationId,
    assetId,
  });
  expect(f.item().editionTitle).toBe("Incorrect label");
  expect(
    await cluster.database.libraryAsset.findUnique({
      where: { path: f.target },
    }),
  ).toBeNull();
});

test("changed bytes after owner review cannot produce metadata-write file authority", async () => {
  const f = await fixture("extended_cut");
  const ready = await f.ready();
  const bytes = await readFile(f.target);
  bytes[0] = bytes[0] === 88 ? 89 : 88;
  await writeFile(f.target, bytes);
  await expect(
    prepareLibraryPlexEditFileV3(
      f.context,
      {
        schemaVersion: 3,
        ...ready.input,
        assetId: z.uuid().parse(ready.prepared.scope.files[0]?.assetId),
      },
      testPublicationExecution(),
    ),
  ).rejects.toThrow("file changed after owner review");
  expect(
    await cluster.database.mediaHandoffObservation.count({
      where: { planId: f.planId, kind: "plex_edit_files_v1" },
    }),
  ).toBe(0);
  expect(f.item().editionTitle).toBe("Incorrect label");
});

test("original read SDK expiry cannot be reset by later file proof work", async () => {
  const f = await fixture("final_cut");
  const ready = await f.ready();
  const execution = testPublicationExecution();
  const clock = vi
    .spyOn(Date, "now")
    .mockReturnValue(execution.expiresAtMs + 1);
  try {
    await expect(
      prepareLibraryPlexEditFileV3(
        f.context,
        {
          schemaVersion: 3,
          ...ready.input,
          assetId: z.uuid().parse(ready.prepared.scope.files[0]?.assetId),
        },
        execution,
      ),
    ).rejects.toThrow("expired");
  } finally {
    clock.mockRestore();
  }
  expect(
    await cluster.database.mediaHandoffObservation.count({
      where: { planId: f.planId, kind: "plex_edit_files_v1" },
    }),
  ).toBe(0);
});

test.each(MovieEditionKeySchema.options)(
  "v3 updates only the %s label and preserves the item, original bytes and watch progress",
  async (edition) => {
    const f = await fixture(edition, "from_filename");
    const ready = await f.ready();
    const input = {
      schemaVersion: 3 as const,
      ...ready.input,
      assetId: z.uuid().parse(ready.prepared.scope.files[0]?.assetId),
    };
    const filesObservation = await prepareLibraryPlexEditFileV3(
      f.context,
      input,
      testPublicationExecution(),
    );
    const original = f.item();
    const editMovieEdition = vi.fn(() => {
      f.setItem({
        ...f.item(),
        editionTitle: MOVIE_EDITION_REGISTRY[edition].plexLabel,
        viewOffset: (f.item().viewOffset ?? 0) + 1000,
      });
      return Promise.resolve();
    });
    const context = {
      db: cluster.database,
      expectedServerMachineId: "server",
      plex: {
        machineIdentifier: f.network.context.plex.machineIdentifier,
        metadataForEditionEdit: () => Promise.resolve(f.item()),
        editMovieEdition,
      },
    };
    context.expectedServerMachineId = await context.plex.machineIdentifier();
    const reference = await editLibraryPlexEditionV3(
      context,
      { ...input, filesObservation },
      bindingTestExecution(),
    );
    expect(editMovieEdition).toHaveBeenCalledExactlyOnceWith(
      {
        sectionId: String(original.librarySectionID),
        ratingKey: "123",
        edition,
      },
      expect.any(AbortSignal),
    );
    const row =
      await cluster.database.mediaHandoffObservation.findUniqueOrThrow({
        where: { id: reference.id },
      });
    expect(PlexEditionCompletionV1Schema.parse(row.evidence)).toMatchObject({
      response: "acknowledged",
      before: { watch: { viewCount: 3, viewOffset: 456_000 } },
      after: {
        identity: { ratingKey: "123", canonicalPath: f.target },
        watch: { viewCount: 3, viewOffset: 457_000 },
      },
    });
    expect(await readFile(f.target, "utf8")).toBe(f.bytes);
    expect(
      await cluster.database.libraryAsset.findUnique({
        where: { path: f.target },
      }),
    ).toBeNull();
    expect(
      await editLibraryPlexEditionV3(
        context,
        { ...input, filesObservation },
        bindingTestExecution(),
      ),
    ).toEqual(reference);
    expect(editMovieEdition).toHaveBeenCalledTimes(1);
    await f.observe();
    const receiptId = await applyPreparedHandoff(
      f.context,
      ready.input,
      await prepareHandoffFiles(f.context, f.planId),
    );
    const parent = await cluster.database.$transaction((tx) =>
      loadMovieLibraryParentV2(
        tx,
        { receiptId, assetId: input.assetId },
        new PublicationAuthorityReadBudget(),
      ),
    );
    expect(parent.asset).toMatchObject({
      path: f.target,
      edition,
      version: 0,
      scope: { edition },
    });
    expect(parent.reference).toMatchObject({
      receiptId,
      kind: "movie_library_adoption_v2",
    });
    const sql = await cluster.database.$queryRaw<{ valid: boolean }[]>`
      SELECT media_movie_subtitle_parent(${JSON.stringify(parent.reference)}::jsonb, a,
        ${JSON.stringify(parent.asset.scope)}::jsonb) AS valid FROM "LibraryAsset" a WHERE id=${input.assetId}`;
    expect(sql).toEqual([{ valid: true }]);
    const exhausted = new PublicationAuthorityReadBudget();
    exhausted.consume(98);
    await expect(
      cluster.database.$transaction((tx) =>
        loadMovieLibraryParentV2(
          tx,
          { receiptId, assetId: input.assetId },
          exhausted,
        ),
      ),
    ).rejects.toThrow("100 total queried records");
    expect(await readFile(f.target, "utf8")).toBe(f.bytes);
  },
);

test("automatic v3 suggestions protect DC until the exact file has explicit owner classification", async () => {
  const f = await libraryPlexFixture(cluster.database, "directors_cut", {
    classify: "owner_review",
    fileName: "Synthetic Film.DC.mkv",
  });
  directories.push(f.directory);
  const detail = await f.commands.detail(f.network.actor, f.planId);
  const input = PrepareLibraryHandoffV3Schema.parse({
    ...detail.scope.request,
    movies: [],
  });
  await expect(
    f.commands.prepare(f.network.actor, crypto.randomUUID(), input),
  ).rejects.toMatchObject({
    code: "library_movie_classification_requires_review",
  });
  expect(
    await cluster.database.libraryAsset.findUnique({
      where: { path: f.target },
    }),
  ).toBeNull();
});

test("v3 observes a delivered edit after a lost response and never resends it", async () => {
  const f = await fixture("directors_cut");
  const ready = await f.ready();
  const input = {
    schemaVersion: 3 as const,
    ...ready.input,
    assetId: z.uuid().parse(ready.prepared.scope.files[0]?.assetId),
  };
  const filesObservation = await prepareLibraryPlexEditFileV3(
    f.context,
    input,
    testPublicationExecution(),
  );
  const editMovieEdition = vi.fn(() => {
    f.setItem({ ...f.item(), editionTitle: "Director's Cut" });
    return Promise.reject(
      new Error("Synthetic connection lost after delivery"),
    );
  });
  const context = {
    db: cluster.database,
    expectedServerMachineId: await f.network.context.plex.machineIdentifier(),
    plex: {
      machineIdentifier: f.network.context.plex.machineIdentifier,
      metadataForEditionEdit: () => Promise.resolve(f.item()),
      editMovieEdition,
    },
  };
  const reference = await editLibraryPlexEditionV3(
    context,
    { ...input, filesObservation },
    bindingTestExecution(),
  );
  const row = await cluster.database.mediaHandoffObservation.findUniqueOrThrow({
    where: { id: reference.id },
  });
  expect(PlexEditionCompletionV1Schema.parse(row.evidence).response).toBe(
    "lost_or_unobserved",
  );
  await cluster.database.mediaUser.update({
    where: { id: f.network.actor.id },
    data: { restricted: true },
  });
  await cluster.database.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { version: { increment: 1 } },
  });
  expect(
    await editLibraryPlexEditionV3(
      context,
      { ...input, filesObservation },
      bindingTestExecution(),
    ),
  ).toEqual(reference);
  expect(editMovieEdition).toHaveBeenCalledTimes(1);
});
