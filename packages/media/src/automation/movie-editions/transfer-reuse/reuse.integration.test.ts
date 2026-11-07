import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import {
  movieTransferReuseFixture,
  movieTransferSeedInput as actualSeedInput,
  movieTransferDependencyEvidence,
} from "./fixture.test-support.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { readMovieTransferReuseMarkerV1 } from "#infrastructure/movie-editions/transfer-reuse/read.ts";
import { movieRetryBirthHash } from "#infrastructure/movie-editions/lifecycle/retry/retry-source.ts";
import { createSeedingActivities } from "#automation/seeding.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { submitMovieTorrentV4 } from "#automation/movie-editions/submission.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { z } from "zod";

let bytes: Uint8Array;
const close: (() => Promise<void>)[] = [];
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const done of close.splice(0)) await done();
});
async function fixture(
  edition: (typeof MovieEditionKeySchema.options)[number] = "extended_cut",
  options = {},
) {
  const f = await movieTransferReuseFixture(edition, bytes, options);
  close.push(f.close);
  return f;
}

test.each(MovieEditionKeySchema.options)(
  "a genuine new %s acquisition consumes one cancelled registered source without renewing its old birth",
  async (edition) => {
    const f = await fixture(edition);
    f.source.wire.control.ratio = 1;
    const oldHash = movieRetryBirthHash(f.origin);
    const current = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.input.attemptId },
    });
    expect(current.id).not.toBe(f.origin.id);
    expect(current.operationId).not.toBe(f.origin.operationId);
    expect(current.generations).not.toEqual(f.origin.generations);
    expect(current.movieEditionChoiceId).not.toBe(
      f.origin.movieEditionChoiceId,
    );
    expect(
      await f.movie.submitMovieTorrentV4(f.input, testPlexBindingExecution()),
    ).toEqual({ status: "submitted", reason: null });
    const birth = await f.db.operation.findUniqueOrThrow({
      where: { id: current.operationId },
    });
    const grant = readMovieTransferReuseMarkerV1(birth.result);
    expect(grant).toMatchObject({
      consumer: {
        attemptId: current.id,
        birthOperationId: current.operationId,
      },
      origin: {
        attemptId: f.origin.id,
        birthOperationId: f.origin.operationId,
      },
      transfer: { id: f.origin.torrentId },
    });
    expect(f.described).toEqual([
      `media-operation-${z.uuid().parse(f.origin.coordinatorOperationId)}`,
      `media-acquire-${f.origin.id}`,
    ]);
    expect(f.source.wire.additions()).toBe(1);
    expect(
      await f.movie.observeMovieAcquisitionV4(
        f.input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "ready", reason: null });
    const seed = createSeedingActivities(f.context);
    const torrentId = f.origin.torrent?.id;
    if (torrentId === undefined)
      throw new Error("Fixture omitted registered source");
    const seedInput = await actualSeedInput(f);
    expect(await seed.evaluateMediaSeeding(seedInput)).toMatchObject({
      status: "protected",
      reason: "source_in_use",
    });
    expect(
      await f.fileMovie.inspectAndStageMovieV4(
        f.input,
        testPublicationExecution(),
      ),
    ).toEqual({ status: "staged" });
    expect(await seed.removeMediaTorrent(seedInput)).toMatchObject({
      status: "protected",
    });
    expect(
      await f.fileMovie.promoteMovieFilesV4(
        f.input,
        testPublicationExecution(),
      ),
    ).toEqual({ status: "published" });
    expect(await seed.evaluateMediaSeeding(seedInput)).toMatchObject({
      status: "protected",
    });
    expect(
      await f.movie.publishMovieToPlexV4(f.input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await f.movie.finalizeMovieAcquisitionV4(
      f.input,
      testPlexBindingExecution(),
    );
    const assets = await f.db.libraryAsset.findMany({ where: { torrentId } });
    expect(assets).toHaveLength(1);
    const asset = assets[0];
    if (asset === undefined) throw new Error("Actual publication missing");
    const library = workerFilePath(f.source.files.context, asset.path);
    expect(new Uint8Array(await readFile(library))).toEqual(bytes);
    const originalPath = path.join(
      f.source.files.roots.movies.downloads,
      "media",
      f.origin.id,
    );
    const sourceBytes = await readFile(
      path.join(
        originalPath,
        grant?.transfer.contentPath.split("/").at(-1) ?? "missing",
      ),
    );
    expect(sourceBytes.byteLength).toBe(bytes.byteLength);
    expect(
      movieRetryBirthHash(
        await f.db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: f.origin.id },
        }),
      ),
    ).toBe(oldHash);
    expect(await f.db.torrent.count({ where: { id: torrentId } })).toBe(1);
    expect(
      await f.db.operation.count({
        where: { idempotencyKey: `seed:${torrentId}` },
      }),
    ).toBe(1);
    const drained = await seed.evaluateMediaSeeding(seedInput);
    expect(
      drained,
      JSON.stringify(await movieTransferDependencyEvidence(f)),
    ).toEqual({ status: "removable", reason: "obligations_satisfied" });
    expect(await seed.removeMediaTorrent(seedInput)).toEqual({
      status: "removed",
      reason: null,
    });
    expect(f.source.wire.control.deletes).toBe(1);
    await expect(
      readFile(
        path.join(
          originalPath,
          path.basename(grant?.transfer.contentPath ?? "missing"),
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(new Uint8Array(await readFile(library))).toEqual(bytes);
    expect(await f.db.acquisitionAttempt.count({ where: { torrentId } })).toBe(
      2,
    );
    expect(await f.db.libraryAsset.count({ where: { torrentId } })).toBe(1);
  },
);

test.each([
  "open_root",
  "missing_child",
  "removing",
  "removed",
  "missing_source",
  "copied_tags",
  "wrong_provider",
  "wrong_epoch",
  "policy_drift",
])(
  "%s protects a recognized source and never issues another add",
  async (change) => {
    const f = await fixture();
    if (change === "open_root")
      f.context.describeWorkflow = () =>
        Promise.resolve({ status: "RUNNING", runId: "synthetic-open" });
    if (change === "missing_child")
      f.context.describeWorkflow = (id) =>
        Promise.resolve(
          id.startsWith("media-acquire-")
            ? null
            : { status: "COMPLETED", runId: "synthetic-root" },
        );
    if (change === "removing" || change === "removed")
      await f.db.torrent.update({
        where: { id: f.origin.torrentId ?? "missing" },
        data: { state: change },
      });
    if (change === "missing_source") f.source.wire.control.visible = false;
    if (change === "copied_tags")
      await f.db.torrent.update({
        where: { id: f.origin.torrentId ?? "missing" },
        data: { owned: false },
      });
    if (change === "wrong_provider")
      await f.db.torrent.update({
        where: { id: f.origin.torrentId ?? "missing" },
        data: { providerId: "foreign" },
      });
    if (change === "wrong_epoch")
      await f.db.torrent.update({
        where: { id: f.origin.torrentId ?? "missing" },
        data: { ownershipEpoch: 1 },
      });
    if (change === "policy_drift") {
      const observe = f.context.qbittorrent.observe.bind(f.context.qbittorrent);
      vi.spyOn(f.context.qbittorrent, "observe").mockImplementation(
        async (...args) => {
          const row = await observe(...args);
          return row === null ? null : { ...row, auto_tmm: true };
        },
      );
    }
    expect(await submitMovieTorrentV4(f.context, f.input)).toMatchObject({
      status: "blocked",
    });
    expect(f.source.wire.additions()).toBe(1);
    expect(
      await f.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.input.attemptId },
      }),
    ).toMatchObject({ torrentId: null, state: "reserved" });
  },
);

test("a real prior lost-add reconciliation and a genuinely new current profile assessment qualify without changing source policy", async () => {
  const f = await fixture("final_cut", {
    lostReply: true,
    profileChange: true,
  });
  expect(await submitMovieTorrentV4(f.context, f.input)).toMatchObject({
    status: "submitted",
  });
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: f.input.operationId },
  });
  expect(
    readMovieTransferReuseMarkerV1(operation.result)?.consumer.profileVersion,
  ).toBe(1);
  expect(f.source.wire.additions()).toBe(1);
  expect(
    await f.db.torrent.findUniqueOrThrow({
      where: { id: f.origin.torrentId ?? "missing" },
    }),
  ).toMatchObject({ seedingPolicy: f.origin.torrent?.seedingPolicy });
});

test("the invocation's already spent 99-row budget cannot be renewed for transfer admission", async () => {
  const f = await fixture();
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  const execution = testPlexBindingExecution();
  await expect(
    submitMovieTorrentV4(
      { ...f.context, movieManagement: { execution, budget } },
      f.input,
    ),
  ).rejects.toThrow("100 total queried records");
  expect(f.source.wire.additions()).toBe(1);
});

test("a grant that commits during source evaluation is recaptured before the removal effect", async () => {
  const f = await fixture();
  f.source.wire.control.ratio = 1;
  let admitted = false;
  f.source.wire.control.beforeInfo = async () => {
    if (admitted) return;
    admitted = true;
    expect(await submitMovieTorrentV4(f.context, f.input)).toMatchObject({
      status: "submitted",
    });
  };
  const torrentId = z.uuid().parse(f.origin.torrentId);
  expect(
    await createSeedingActivities(f.context).removeMediaTorrent(
      await actualSeedInput(f),
    ),
  ).toMatchObject({
    status: "protected",
    reason: "source_dependencies_changed",
  });
  expect(f.source.wire.control.deletes).toBe(0);
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.input.attemptId },
    }),
  ).toMatchObject({ torrentId, state: "downloading" });
});

test("a lost remove reply retains its unresolved source claim and blocks a later grant", async () => {
  const f = await fixture();
  f.source.wire.control.ratio = 1;
  f.source.wire.control.loseRemoveReply = true;
  const torrentId = z.uuid().parse(f.origin.torrentId);
  await expect(
    createSeedingActivities(f.context).removeMediaTorrent(
      await actualSeedInput(f),
    ),
  ).rejects.toThrow();
  expect(f.source.wire.control.deletes).toBe(1);
  expect(
    await f.db.torrent.findUniqueOrThrow({ where: { id: torrentId } }),
  ).toMatchObject({ state: "removing" });
  expect(await submitMovieTorrentV4(f.context, f.input)).toMatchObject({
    status: "blocked",
  });
  expect(f.source.wire.additions()).toBe(1);
});

test("a removal holding the final source locks wins before a concurrent consumer can obtain a grant", async () => {
  const f = await fixture();
  f.source.wire.control.ratio = 1;
  const control: { grant: ReturnType<typeof submitMovieTorrentV4> | null } = {
    grant: null,
  };
  f.source.wire.control.beforeRemove = () => {
    control.grant = submitMovieTorrentV4(f.context, f.input);
    return Promise.resolve();
  };
  expect(
    await createSeedingActivities(f.context).removeMediaTorrent(
      await actualSeedInput(f),
    ),
  ).toEqual({ status: "removed", reason: null });
  if (control.grant === null)
    throw new Error(
      "Actual qBit remove did not start the concurrent grant contender",
    );
  expect(await control.grant).toMatchObject({ status: "blocked" });
  expect(f.source.wire.control.deletes).toBe(1);
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.input.attemptId },
    }),
  ).toMatchObject({ torrentId: null, state: "reserved" });
});

test("SQL rejects raw shared attachment, grant mutation/deletion and changes to its literal original source", async () => {
  const f = await fixture();
  await expect(
    f.db.acquisitionAttempt.update({
      where: { id: f.input.attemptId },
      data: { torrentId: f.origin.torrentId, state: "downloading" },
    }),
  ).rejects.toThrow();
  expect(await submitMovieTorrentV4(f.context, f.input)).toMatchObject({
    status: "submitted",
  });
  await expect(
    f.db
      .$executeRaw`UPDATE "Operation" SET result=result-'movieTransferReuseGrantV1' WHERE id=${f.input.operationId}`,
  ).rejects.toThrow("immutable");
  await expect(
    f.db.operation.delete({ where: { id: f.input.operationId } }),
  ).rejects.toThrow();
  await expect(
    f.db.acquisitionAttempt.update({
      where: { id: f.origin.id },
      data: { state: "downloading" },
    }),
  ).rejects.toThrow("literal");
  await expect(
    f.db.acquisitionAttempt.update({
      where: { id: f.input.attemptId },
      data: { torrentId: null },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    f.db.torrent.update({
      where: { id: z.uuid().parse(f.origin.torrentId) },
      data: { seedingPolicy: { kind: "unknown" } },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    f.db.acquisitionAttempt.update({
      where: { id: f.input.attemptId },
      data: { edition: "theatrical_cut" },
    }),
  ).rejects.toThrow();
  await expect(
    f.db
      .$executeRaw`UPDATE "AcquisitionAttempt" SET "identityEvidence"=jsonb_set("identityEvidence",'{source,candidateDigest}',to_jsonb(${"a".repeat(64)}::text)) WHERE id=${f.input.attemptId}`,
  ).rejects.toThrow();
  await expect(
    f.db
      .$executeRaw`UPDATE "AcquisitionAttempt" SET "operationId"=${f.input.operationId} WHERE id=${f.origin.id}`,
  ).rejects.toThrow();
  await expect(
    f.db.torrent.update({
      where: { id: z.uuid().parse(f.origin.torrentId) },
      data: { providerId: "foreign" },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    f.db
      .$executeRaw`UPDATE "Operation" SET result=jsonb_set(result,'{movieTransferReuseGrantV1,grant,origin,attemptId}',to_jsonb(${f.input.attemptId}::text)) WHERE id=${f.input.operationId}`,
  ).rejects.toThrow("immutable");
  const transfer = await f.db.torrent.findUniqueOrThrow({
    where: { id: z.uuid().parse(f.origin.torrentId) },
  });
  const stored = z
    .object({
      torrent: z.record(z.string(), z.json()),
      files: z.array(z.json()),
    })
    .parse(transfer.observation);
  await expect(
    f.db.torrent.update({
      where: { id: transfer.id },
      data: {
        observation: {
          ...stored,
          torrent: {
            ...stored.torrent,
            save_path: `/downloads/media/${f.input.attemptId}`,
            content_path: `/downloads/media/${f.input.attemptId}/forged.mkv`,
            tags: `media-${f.input.operationId},media-attempt-${f.input.attemptId}`,
          },
        },
      },
    }),
  ).rejects.toThrow("direct consumer ownership");
});
