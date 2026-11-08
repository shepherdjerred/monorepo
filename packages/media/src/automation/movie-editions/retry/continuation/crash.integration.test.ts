import { expect, test } from "vitest";
import { z } from "zod";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { queryFixtureDatabase } from "#testing/query-client.ts";
import { createMovieFileFacetV4 } from "#automation/files/movie-editions/activities.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { MovieRetryPlexAcknowledgementV1Schema } from "#shared/movie-editions/retry/v2.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { continuationHarness, attemptInput } from "./support.ts";

const h = continuationHarness();
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

test("actual upgraded video and two sidecar journals settle after a database failure without repeating their native moves", async () => {
  const f = await h.fixture("extended_cut", "intent", { upgrade: true });
  const queued = await f.retry();
  expect(
    await f.movie.reconcileMovieIntentV4(
      queued.input,
      testPlexBindingExecution(),
    ),
  ).toMatchObject({ status: "acquire" });
  const before = await f.evidence();
  if (before.plan === null)
    throw new Error("Actual upgrade plan missing before the fault boundary");
  const entry = before.plan.entries[0];
  expect(entry.previousSidecars).toHaveLength(2);
  const input = await attemptInput(f, queued.input.operationId);
  const failure = new Error(
    "Synthetic publication outcome database failure after actual movie effects",
  );
  let boundary = false;
  const effects: string[] = [];
  const db = queryFixtureDatabase(f.db, {
    query: {
      mediaPublicationTransition: {
        update({ args, query }) {
          if (
            z
              .object({ kind: z.literal("published") })
              .safeParse(args.data.outcome).success
          ) {
            boundary = true;
            throw failure;
          }
          return query(args);
        },
      },
    },
  });
  await expect(
    createMovieFileFacetV4({
      ...f.files,
      db,
      checkpoint: async (phase) => {
        await f.files.checkpoint(phase);
        if (["published", "move-unlinked"].includes(phase)) effects.push(phase);
      },
    }).promoteMovieFilesV4(input, testPublicationExecution()),
  ).rejects.toBe(failure);
  expect(boundary).toBe(true);
  expect(effects.filter((phase) => phase === "published")).toHaveLength(1);
  expect(effects.filter((phase) => phase === "move-unlinked")).toHaveLength(2);
  expect(await f.evidence()).toEqual(before);
  const journals = await f.journalEvidence();
  expect(journals).toHaveLength(3);
  for (const row of journals)
    expect(
      z
        .object({
          operationId: z.literal(row.id),
          phase: z.literal("complete"),
        })
        .parse(JSON.parse(z.string().parse(row.literal))).phase,
    ).toBe("complete");
  const published = await readFile(
    path.join(f.files.roots.movies.library, entry.libraryPath),
  );
  expect(published.byteLength).toBe(h.upgrade.byteLength);
  expect(sha256(published)).toBe(sha256(h.upgrade));
  for (const sidecar of entry.previousSidecars)
    expect(
      sha256(
        await readFile(
          path.join(
            f.files.roots.movies.control,
            "quarantine",
            sidecar.quarantineId,
          ),
        ),
      ),
    ).toBe(sidecar.checksum);
  const repeated: string[] = [];
  expect(
    await createMovieFileFacetV4({
      ...f.files,
      checkpoint: async (phase) => {
        await f.files.checkpoint(phase);
        if (["published", "move-unlinked"].includes(phase))
          repeated.push(phase);
      },
    }).promoteMovieFilesV4(input, testPublicationExecution()),
  ).toEqual({ status: "published" });
  expect(repeated).toEqual([]);
  expect(await f.journalEvidence()).toEqual(journals);
  const completed = await f.evidence();
  expect(completed.publication?.intent).toEqual(before.publication?.intent);
  expect(completed.publication?.intentHash).toBe(
    before.publication?.intentHash,
  );
  expect(completed.attempt?.filePlan).toEqual(before.attempt?.filePlan);
  expect(completed.adds).toBe(1);
}, 60_000);

test("real old-input finalization survives a lost new-ACK write and a fresh historical ACK repeats no logical effects", async () => {
  const f = await h.fixture("uncut_version", "plex");
  const queued = await f.retry();
  const before = await f.evidence();
  if (before.attempt === null)
    throw new Error("Actual Plex-committed acquisition missing");
  const attemptId = before.attempt.id;
  const failure = new Error(
    "Synthetic ACK dependency failure after actual old-input finalization",
  );
  let boundary = false;
  const db = queryFixtureDatabase(f.db, {
    query: {
      operation: {
        async findUniqueOrThrow({ args, query }) {
          if (args.where.id === queued.input.operationId) {
            const current = await f.db.acquisitionAttempt.findUniqueOrThrow({
              where: { id: attemptId },
            });
            if (current.state === "completed") {
              boundary = true;
              throw failure;
            }
          }
          return query(args);
        },
      },
    },
  });
  await expect(
    createMovieNetworkFacetV4({ ...f.context, db }).reconcileMovieIntentV4(
      queued.input,
      testPlexBindingExecution(),
    ),
  ).rejects.toBe(failure);
  expect(boundary).toBe(true);
  const finalized = await f.evidence();
  expect(finalized.attempt).toMatchObject({
    state: "completed",
    coordinatorOperationId: before.attempt.coordinatorOperationId,
    filePlan: before.attempt.filePlan,
  });
  const markerMissing = await f.db.operation.findUniqueOrThrow({
    where: { id: queued.input.operationId },
  });
  expect(
    z
      .object({ movieRetryPlexAcknowledgementV1: z.unknown().optional() })
      .nullable()
      .parse(markerMissing.result)?.movieRetryPlexAcknowledgementV1,
  ).toBeUndefined();
  const logical = await f.db.operation.findMany({
    where: {
      kind: {
        in: [
          "acquire_movie_subtitles_v4",
          "maintain_torrent",
          "deliver_notification",
        ],
      },
    },
    orderBy: { id: "asc" },
  });
  expect(
    logical.filter((row) => row.kind === "acquire_movie_subtitles_v4"),
  ).toHaveLength(2);
  expect(logical.filter((row) => row.kind === "maintain_torrent")).toHaveLength(
    1,
  );
  f.useDescriptions(() =>
    Promise.reject(
      new Error("Actual completed ACK must not repeat terminal observations"),
    ),
  );
  const ack = createMovieNetworkFacetV4({
    ...f.context,
    permittedSections: () =>
      Promise.reject(
        new Error("Actual completed ACK must precede current configuration"),
      ),
  });
  expect(
    await ack.reconcileMovieIntentV4(queued.input, testPlexBindingExecution()),
  ).toMatchObject({ status: "available", attemptId: null });
  expect(await f.evidence()).toEqual(finalized);
  expect(
    await f.db.operation.findMany({
      where: {
        kind: {
          in: [
            "acquire_movie_subtitles_v4",
            "maintain_torrent",
            "deliver_notification",
          ],
        },
      },
      orderBy: { id: "asc" },
    }),
  ).toEqual(logical);
  const stored = await f.db.operation.findUniqueOrThrow({
    where: { id: queued.input.operationId },
  });
  expect(
    MovieRetryPlexAcknowledgementV1Schema.parse(
      z
        .object({ movieRetryPlexAcknowledgementV1: z.json() })
        .parse(stored.result).movieRetryPlexAcknowledgementV1,
    ),
  ).toMatchObject({ kind: "historical_ack", terminal: null, completed: true });
}, 60_000);
