import { afterEach, beforeAll, expect, test } from "vitest";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createMovieRetentionFixture } from "#testing/movie-workflow/retention-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import { MovieRestoreReceiptEnvelopeV1Schema } from "#shared/movie-editions/restore-v1.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { warningHistory } from "#automation/retention/fixtures/elapsed.ts";
import { quarantineMovieFilesV4 } from "./quarantine.ts";
import { restoreMovieFilesV4 } from "./restore.ts";

const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
type Fixture = Awaited<ReturnType<typeof createMovieRetentionFixture>>;

function invocation(f: Fixture) {
  const execution = testPublicationExecution();
  return {
    ...f.source.files.context,
    publicationExecution: () => execution,
    movieManagement: {
      execution,
      budget: new PublicationAuthorityReadBudget(),
    },
  };
}

async function ready() {
  const f = await createMovieRetentionFixture("directors_cut", bytes);
  closers.push(f.close);
  expect(await f.warning()).toMatchObject({ status: "warning" });
  await f.deliverWarning();
  const result = await f.evaluate();
  expect(result.status).toBe("quarantine");
  if (result.decisionId === null || f.context.now === undefined)
    throw new Error("Actual retention producer omitted its authority");
  await quarantineMovieFilesV4(
    { ...invocation(f), now: f.context.now },
    {
      schemaVersion: 4,
      operationId: f.input.operationId,
      decisionId: result.decisionId,
      scope: f.scope,
    },
  );
  const request = await requestTestMovieV4(
    f.db,
    f.source.user,
    f.scope.mediaId,
    f.scope.edition,
  );
  expect(
    await f.db.operation.findUniqueOrThrow({
      where: { id: request.input.operationId },
    }),
  ).toMatchObject({ kind: "restore_movie_edition_v4", result: null });
  return { f, input: request.input, decisionId: result.decisionId };
}

async function state(f: Fixture, decisionId: string, operationId: string) {
  return {
    asset: await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
      include: { subtitles: { orderBy: { id: "asc" } }, coverage: true },
    }),
    decision: await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: decisionId },
    }),
    pointer: await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
    }),
    quarantine: await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    }),
    publication: await f.db.operation.findUniqueOrThrow({
      where: { id: f.publicationOperationId },
    }),
    command: await f.db.operation.findUniqueOrThrow({
      where: { id: operationId },
    }),
    history: await warningHistory(f.db, decisionId),
    publications: await f.db.mediaPublicationTransition.findMany({
      orderBy: { id: "asc" },
    }),
  };
}

async function originalFiles(f: Fixture, decisionId: string) {
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
      const target = path.join(
        f.source.files.roots.movies.library,
        file.libraryPath,
      );
      await expect(access(target)).rejects.toMatchObject({ code: "ENOENT" });
      return { ...file, source, target, bytes: await readFile(source) };
    }),
  );
}

async function restoredJournals(
  f: Fixture,
  operationId: string,
  original: Awaited<ReturnType<typeof originalFiles>>,
) {
  const literals = [];
  for (const file of original) {
    await expect(access(file.source)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(file.target)).toEqual(file.bytes);
    const id = `${operationId}-restore-${file.quarantineId}`;
    const literal = await readFile(
      path.join(f.source.files.roots.movies.control, "journal", `${id}.json`),
      "utf8",
    );
    expect(ManifestSchema.parse(JSON.parse(literal))).toMatchObject({
      operationId: id,
      kind: "restore",
      phase: "complete",
      source: file.source,
      target: file.target,
      sha256: file.checksum,
      previousSha256: null,
    });
    literals.push(literal);
  }
  return literals;
}

test("all actual restore journals survive a final database failure and a fresh Activity settles those exact effects", async () => {
  const { f, input, decisionId } = await ready();
  const before = await state(f, decisionId, input.operationId);
  const original = await originalFiles(f, decisionId);
  const failure = new Error(
    "Synthetic database failure after actual movie restore journals",
  );
  let injected = false;
  let firstMoves = 0;
  const db = queryFixtureDatabase(f.db, {
    query: {
      retentionDecision: {
        update({ args, query }) {
          if (args.data.state === "restored") {
            injected = true;
            throw failure;
          }
          return query(args);
        },
      },
    },
  });
  await expect(
    restoreMovieFilesV4(
      {
        ...invocation(f),
        db,
        checkpoint: (phase) => {
          if (phase === "move-unlinked") firstMoves++;
          return Promise.resolve();
        },
      },
      input,
    ),
  ).rejects.toBe(failure);
  expect(injected).toBe(true);
  expect(firstMoves).toBe(3);
  expect(await state(f, decisionId, input.operationId)).toEqual(before);
  const literals = await restoredJournals(f, input.operationId, original);
  expect(literals).toHaveLength(3);
  let repeatedMoves = 0;
  const retry = invocation(f);
  await restoreMovieFilesV4(
    {
      ...retry,
      checkpoint: (phase) => {
        if (phase === "move-unlinked") repeatedMoves++;
        return Promise.resolve();
      },
    },
    input,
  );
  expect(repeatedMoves).toBe(0);
  expect(() => retry.movieManagement.budget.consume(0)).not.toThrow();
  expect(await restoredJournals(f, input.operationId, original)).toEqual(
    literals,
  );
  const after = await state(f, decisionId, input.operationId);
  expect(after.asset).toMatchObject({
    state: "published",
    version: f.asset.version + 2,
    plexPublishedAt: before.asset.plexPublishedAt,
    path: before.asset.path,
  });
  for (const subtitle of before.asset.subtitles)
    expect(after.asset.subtitles.find((row) => row.id === subtitle.id)).toEqual(
      subtitle.state === "quarantined"
        ? {
            ...subtitle,
            state: "installed",
            videoVersion: after.asset.version,
            version: subtitle.version + 1,
          }
        : subtitle,
    );
  expect(after.decision).toMatchObject({
    state: "restored",
    manifest: before.decision.manifest,
    version: before.decision.version + 1,
    evidence: { restoreOperationId: input.operationId },
  });
  expect(after.quarantine).toEqual(before.quarantine);
  expect(after.publication).toEqual(before.publication);
  expect(after.pointer).toEqual(before.pointer);
  expect(after.history).toEqual(before.history);
  expect(after.publications).toEqual(before.publications);
  const envelope = MovieRestoreReceiptEnvelopeV1Schema.parse(
    z.object({ movieRestoreReceiptV1: z.unknown() }).parse(after.command.result)
      .movieRestoreReceiptV1,
  );
  expect(envelope.receiptHash).toBe(identityHash(envelope.receipt));
  expect(envelope.receipt).toMatchObject({
    input,
    before: { id: f.asset.id, version: before.asset.version },
    after: { id: f.asset.id, version: after.asset.version },
  });
  expect(envelope.receipt.journals.map((journal) => journal.raw)).toEqual(
    literals,
  );
}, 60_000);

test.each(["allowance", "kind", "scope"] as const)(
  "an invalid restore %s cannot move bytes or invent a physical grant",
  async (change) => {
    const { f, input, decisionId } = await ready();
    const before = await state(f, decisionId, input.operationId);
    const original = await originalFiles(f, decisionId);
    const context = invocation(f);
    const budget = context.movieManagement.budget;
    if (change === "allowance") budget.consume(99);
    const selected =
      change === "kind"
        ? f.input
        : change === "scope"
          ? {
              ...input,
              scope: { ...input.scope, edition: "extended_cut" as const },
            }
          : input;
    const effect = restoreMovieFilesV4(context, selected);
    if (change === "allowance") {
      await expect(effect).rejects.toMatchObject({
        code: "archive_transition_reconciliation_required",
      });
      expect(() => budget.consume(0)).toThrow("100 total queried records");
    } else await expect(effect).rejects.toThrow();
    expect(await state(f, decisionId, input.operationId)).toEqual(before);
    expect(await originalFiles(f, decisionId)).toEqual(original);
    const names = await readdir(
      path.join(f.source.files.roots.movies.control, "journal"),
    );
    expect(
      names.filter((name) => name.startsWith(`${input.operationId}-restore-`)),
    ).toEqual([]);
  },
  60_000,
);
