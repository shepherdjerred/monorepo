import { afterEach, beforeAll, expect, test } from "vitest";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createMovieRetentionFixture } from "#testing/movie-workflow/retention-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { queueOperation } from "#automation/store.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import { warningHistory } from "#automation/retention/fixtures/elapsed.ts";
import { evaluateMovieRetentionV4 } from "./evaluate.ts";
import { quarantineMovieFilesV4 } from "./quarantine.ts";
import { purgeMovieFilesV4 } from "./purge.ts";

const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
type Fixture = Awaited<ReturnType<typeof createMovieRetentionFixture>>;
const real = () => new Date();
const elapsed = () => new Date(Date.now() + 8 * 86_400_000);

function files(f: Fixture, now: () => Date) {
  const execution = testPublicationExecution();
  return {
    ...f.source.files.context,
    now,
    publicationExecution: () => execution,
    movieManagement: {
      execution,
      budget: new PublicationAuthorityReadBudget(),
    },
  };
}

async function ready(edition: MovieEditionKey, otherCut = false) {
  const f = await createMovieRetentionFixture(edition, bytes);
  closers.push(f.close);
  const otherEdition =
    edition === "directors_cut" ? "final_cut" : "directors_cut";
  if (otherCut)
    await requestTestMovieV4(
      f.db,
      f.source.user,
      f.scope.mediaId,
      otherEdition,
    );
  expect(await f.warning()).toMatchObject({ status: "warning" });
  await f.deliverWarning();
  const result = await f.evaluate();
  expect(result.status).toBe("quarantine");
  if (result.decisionId === null)
    throw new Error("Actual warning omitted its retention decision");
  const input = {
    schemaVersion: 4 as const,
    operationId: f.input.operationId,
    decisionId: result.decisionId,
    scope: f.scope,
  };
  await quarantineMovieFilesV4(files(f, elapsed), input);
  return { f, input, otherEdition };
}

async function evaluate(
  f: Fixture,
  input: z.infer<typeof MovieOperationV4Schema>,
  now: () => Date,
) {
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  const result = await evaluateMovieRetentionV4(
    { ...f.context, now, movieManagement: { execution, budget } },
    input,
    execution,
  );
  expect(() => budget.consume(0)).not.toThrow();
  return result;
}

async function laterCommand(f: Fixture) {
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
    },
  });
  const operationId = await f.db.$transaction((tx) =>
    queueOperation(tx, {
      key: `synthetic-later-movie-purge:${crypto.randomUUID()}`,
      kind: "retain_movie_edition_v4",
      targetId: f.scope.mediaId,
      payload: {
        schemaVersion: 4,
        scope: f.scope,
        mediaId: f.scope.mediaId,
        generation: target.generation,
      },
    }),
  );
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: operationId },
  });
  return MovieOperationV4Schema.parse(
    z.object(MovieOperationV4Schema.shape).parse(operation.payload),
  );
}

async function state(f: Fixture, decisionId: string) {
  return {
    asset: await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
      include: { subtitles: { orderBy: { id: "asc" } }, coverage: true },
    }),
    decision: await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: decisionId },
    }),
    parent: await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    }),
    publication: await f.db.operation.findUniqueOrThrow({
      where: { id: f.publicationOperationId },
    }),
    pointer: await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
    }),
    history: await warningHistory(f.db, decisionId),
  };
}

async function quarantinedBytes(f: Fixture, decisionId: string) {
  const decision = await f.db.retentionDecision.findUniqueOrThrow({
    where: { id: decisionId },
  });
  const entry = RemovalPlanSchema.parse(decision.manifest).assets[0];
  if (entry === undefined)
    throw new Error("Actual quarantine omitted its manifest");
  expect(entry.sidecars).toHaveLength(2);
  return Promise.all(
    [entry, ...entry.sidecars].map(async (file) => {
      const source = path.join(
        f.source.files.roots.movies.control,
        "quarantine",
        file.quarantineId,
      );
      return { ...file, source, bytes: await readFile(source) };
    }),
  );
}

async function assertNoPurgeJournals(f: Fixture, operationId: string) {
  const journals = await readdir(
    path.join(f.source.files.roots.movies.control, "journal"),
  );
  expect(
    journals.filter((name) => name.startsWith(`${operationId}-purge-`)),
  ).toEqual([]);
}

async function assertPurgeJournals(
  f: Fixture,
  operationId: string,
  original: Awaited<ReturnType<typeof quarantinedBytes>>,
) {
  for (const file of original) {
    await expect(access(file.source)).rejects.toMatchObject({ code: "ENOENT" });
    const id = `${operationId}-purge-${file.quarantineId}`;
    expect(
      ManifestSchema.parse(
        JSON.parse(
          await readFile(
            path.join(
              f.source.files.roots.movies.control,
              "journal",
              `${id}.json`,
            ),
            "utf8",
          ),
        ),
      ),
    ).toMatchObject({
      operationId: id,
      kind: "purge",
      source: file.source,
      target: file.source,
      sha256: file.checksum,
      phase: "complete",
      previousSha256: null,
    });
  }
}

test.each(MovieEditionKeySchema.options)(
  "%s respects the real quarantine window and a later command purges its exact video and both captions",
  async (edition) => {
    const { f, input, otherEdition } = await ready(edition, true);
    const before = await state(f, input.decisionId);
    const original = await quarantinedBytes(f, input.decisionId);
    const other = await f.db.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: otherEdition },
      },
    });
    expect(await evaluate(f, f.input, real)).toMatchObject({
      status: "grace",
      decisionId: input.decisionId,
      wakeAt: before.decision.purgeAfter?.toISOString(),
    });
    await expect(
      purgeMovieFilesV4(files(f, real), input),
    ).rejects.toMatchObject({ reason: "retention_not_due" });
    expect(await quarantinedBytes(f, input.decisionId)).toEqual(original);
    await assertNoPurgeJournals(f, input.operationId);
    const later = await laterCommand(f);
    expect(later.operationId).not.toBe(input.operationId);
    expect(await evaluate(f, later, elapsed)).toMatchObject({
      status: "purge",
      decisionId: input.decisionId,
    });
    const purgeInput = { ...input, operationId: later.operationId };
    await purgeMovieFilesV4(files(f, elapsed), purgeInput);
    await assertPurgeJournals(f, later.operationId, original);
    const after = await state(f, input.decisionId);
    expect(after.asset).toMatchObject({
      state: "purged",
      edition,
      version: f.asset.version + 2,
      path: before.asset.path,
    });
    expect(after.asset.coverage).toHaveLength(1);
    expect(after.asset.coverage[0]).toMatchObject({
      current: false,
      mediaId: f.scope.mediaId,
      edition,
    });
    for (const subtitle of before.asset.subtitles) {
      expect(
        after.asset.subtitles.find((row) => row.id === subtitle.id),
      ).toEqual(
        subtitle.state === "quarantined"
          ? {
              ...subtitle,
              state: "purged",
              videoVersion: after.asset.version,
              version: subtitle.version + 1,
            }
          : subtitle,
      );
    }
    expect(after.decision).toMatchObject({
      state: "purged",
      version: before.decision.version + 1,
      manifest: before.decision.manifest,
      quarantinedAt: before.decision.quarantinedAt,
      purgeAfter: before.decision.purgeAfter,
      evidence: { purgeOperationId: later.operationId },
    });
    expect(after.parent).toEqual(before.parent);
    expect(after.publication).toEqual(before.publication);
    expect(after.pointer).toEqual(before.pointer);
    expect(after.history).toEqual(before.history);
    expect(
      await f.db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
      }),
    ).toMatchObject({ availability: "removed" });
    expect(
      await f.db.mediaIntent.findUniqueOrThrow({
        where: {
          mediaId_edition: { mediaId: f.scope.mediaId, edition: otherEdition },
        },
      }),
    ).toEqual(other);
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: later.operationId },
      }),
    ).toMatchObject({ result: null });
    const acknowledgement = files(f, real);
    await purgeMovieFilesV4(
      {
        ...acknowledgement,
        enabled: {
          ...acknowledgement.enabled,
          purge: () => Promise.resolve(false),
        },
      },
      purgeInput,
    );
    expect(await state(f, input.decisionId)).toEqual(after);
  },
  60_000,
);

test.each(["keep", "generation", "unwatch", "sdk"] as const)(
  "%s protects an eligible quarantined movie and both captions from purge",
  async (change) => {
    const { f, input } = await ready("extended_cut");
    expect(await evaluate(f, f.input, elapsed)).toMatchObject({
      status: "purge",
    });
    const original = await quarantinedBytes(f, input.decisionId);
    const before = await state(f, input.decisionId);
    if (change === "keep")
      await f.db.retentionHold.create({
        data: {
          userId: f.source.user.id,
          mediaId: f.scope.mediaId,
          edition: f.scope.edition,
          until: new Date(Date.now() + 30 * 86_400_000),
        },
      });
    if (change === "generation")
      await requestTestMovieV4(
        f.db,
        f.source.user,
        f.scope.mediaId,
        f.scope.edition,
      );
    if (change === "unwatch") {
      f.source.wire.setWatched(false);
      expect(
        await observeRequesterWatch(f.context, f.scope.mediaId, {
          edition: f.scope.edition,
        }),
      ).toEqual({ complete: true, reason: null });
    }
    const context = files(f, elapsed);
    const execution = context.movieManagement.execution;
    const expiry = new Error("Original purge SDK expired after hashing");
    let expired = false;
    const guarded = {
      ...execution,
      assertActive: () => {
        execution.assertActive();
        if (expired) throw expiry;
      },
    };
    const active =
      change === "sdk"
        ? {
            ...context,
            publicationExecution: () => guarded,
            movieManagement: { ...context.movieManagement, execution: guarded },
            checkpoint: (phase: string) => {
              if (phase === "content-proof-ready") expired = true;
              return Promise.resolve();
            },
          }
        : context;
    if (change === "sdk")
      await expect(purgeMovieFilesV4(active, input)).rejects.toBe(expiry);
    else await expect(purgeMovieFilesV4(active, input)).rejects.toThrow();
    expect(expired).toBe(change === "sdk");
    expect(await quarantinedBytes(f, input.decisionId)).toEqual(original);
    const after = await state(f, input.decisionId);
    expect(after.asset).toEqual(before.asset);
    expect(after.pointer).toEqual(before.pointer);
    expect(after.parent).toEqual(before.parent);
    expect(after.publication).toEqual(before.publication);
    expect(after.decision).toEqual(before.decision);
    await assertNoPurgeJournals(f, input.operationId);
  },
  60_000,
);
