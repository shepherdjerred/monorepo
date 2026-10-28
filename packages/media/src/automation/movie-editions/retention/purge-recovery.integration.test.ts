import { afterEach, beforeAll, expect, test } from "vitest";
import { access, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { createMovieRetentionFixture } from "#testing/movie-workflow/retention-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
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
const elapsed = () => new Date(Date.now() + 8 * 86_400_000);

function invocation(f: Fixture) {
  const execution = testPublicationExecution();
  return {
    ...f.source.files.context,
    now: elapsed,
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
  if (result.decisionId === null)
    throw new Error("Actual warning omitted its decision");
  const input = {
    schemaVersion: 4 as const,
    operationId: f.input.operationId,
    decisionId: result.decisionId,
    scope: f.scope,
  };
  await quarantineMovieFilesV4(invocation(f), input);
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  expect(
    await evaluateMovieRetentionV4(
      { ...f.context, now: elapsed, movieManagement: { execution, budget } },
      f.input,
      execution,
    ),
  ).toMatchObject({ status: "purge", decisionId: input.decisionId });
  expect(() => budget.consume(0)).not.toThrow();
  return { f, input };
}

async function databaseState(f: Fixture, decisionId: string) {
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
    parent: await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    }),
    publication: await f.db.operation.findUniqueOrThrow({
      where: { id: f.publicationOperationId },
    }),
    projection: await f.db.retentionPlexProjection.findUniqueOrThrow({
      where: { decisionId },
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
      return { ...file, source, bytes: await readFile(source) };
    }),
  );
}

async function journals(
  f: Fixture,
  original: Awaited<ReturnType<typeof originalFiles>>,
) {
  const literals = [];
  for (const file of original) {
    await expect(access(file.source)).rejects.toMatchObject({ code: "ENOENT" });
    const operationId = `${f.input.operationId}-purge-${file.quarantineId}`;
    const literal = await readFile(
      path.join(
        f.source.files.roots.movies.control,
        "journal",
        `${operationId}.json`,
      ),
      "utf8",
    );
    expect(ManifestSchema.parse(JSON.parse(literal))).toMatchObject({
      operationId,
      kind: "purge",
      source: file.source,
      target: file.source,
      sha256: file.checksum,
      previousSha256: null,
      phase: "complete",
    });
    literals.push(literal);
  }
  return literals;
}

test("a real purge followed by database failure settles the same original journals in a fresh Activity", async () => {
  const { f, input } = await ready();
  const before = await databaseState(f, input.decisionId);
  const original = await originalFiles(f, input.decisionId);
  const failure = new Error(
    "Synthetic terminal database failure after real movie purges",
  );
  let injected = false;
  let firstPurges = 0;
  const db = queryFixtureDatabase(f.db, {
    query: {
      retentionDecision: {
        update({ args, query }) {
          if (args.data.state === "purged") {
            injected = true;
            throw failure;
          }
          return query(args);
        },
      },
    },
  });
  await expect(
    purgeMovieFilesV4(
      {
        ...invocation(f),
        db,
        checkpoint: (phase) => {
          if (phase === "purged") firstPurges++;
          return Promise.resolve();
        },
      },
      input,
    ),
  ).rejects.toBe(failure);
  expect(injected).toBe(true);
  expect(firstPurges).toBe(3);
  expect(await databaseState(f, input.decisionId)).toEqual(before);
  const originalJournals = await journals(f, original);
  expect(originalJournals).toHaveLength(3);
  let repeatedPurges = 0;
  await purgeMovieFilesV4(
    {
      ...invocation(f),
      checkpoint: (phase) => {
        if (phase === "purged") repeatedPurges++;
        return Promise.resolve();
      },
    },
    input,
  );
  expect(repeatedPurges).toBe(0);
  expect(await journals(f, original)).toEqual(originalJournals);
  const after = await databaseState(f, input.decisionId);
  expect(after.asset).toMatchObject({
    state: "purged",
    version: f.asset.version + 2,
  });
  expect(after.decision).toMatchObject({
    state: "purged",
    version: before.decision.version + 1,
    manifest: before.decision.manifest,
    evidence: { purgeOperationId: input.operationId },
  });
  expect(after.parent).toEqual(before.parent);
  expect(after.publication).toEqual(before.publication);
  expect(after.pointer).toEqual(before.pointer);
  expect(after.projection).toEqual(before.projection);
}, 60_000);

test("missing actual quarantine bytes without this purge's own journal cannot authorize any deletion", async () => {
  const { f, input } = await ready();
  const before = await databaseState(f, input.decisionId);
  const original = await originalFiles(f, input.decisionId);
  const video = original[0];
  if (video === undefined) throw new Error("Actual quarantine video missing");
  // Simulate loss of the exact disposable quarantined video, outside this purge's journal.
  await unlink(video.source);
  await expect(purgeMovieFilesV4(invocation(f), input)).rejects.toMatchObject({
    reason: "purge_source_missing_without_journal",
  });
  expect(await databaseState(f, input.decisionId)).toEqual(before);
  for (const file of original.slice(1))
    expect(await readFile(file.source)).toEqual(file.bytes);
  const names = await readdir(
    path.join(f.source.files.roots.movies.control, "journal"),
  );
  expect(
    names.filter((name) => name.startsWith(`${input.operationId}-purge-`)),
  ).toEqual([]);
}, 60_000);

test("purge preserves the caller's exhausted original allowance before any syscall", async () => {
  const { f, input } = await ready();
  const before = await databaseState(f, input.decisionId);
  const original = await originalFiles(f, input.decisionId);
  const context = invocation(f);
  const budget = context.movieManagement.budget;
  budget.consume(99);
  await expect(purgeMovieFilesV4(context, input)).rejects.toMatchObject({
    code: "archive_transition_reconciliation_required",
  });
  expect(() => budget.consume(0)).toThrow("100 total queried records");
  expect(await databaseState(f, input.decisionId)).toEqual(before);
  for (const file of original)
    expect(await readFile(file.source)).toEqual(file.bytes);
  const names = await readdir(
    path.join(f.source.files.roots.movies.control, "journal"),
  );
  expect(
    names.filter((name) => name.startsWith(`${input.operationId}-purge-`)),
  ).toEqual([]);
}, 60_000);
