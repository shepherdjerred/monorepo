import { afterEach, beforeAll, expect, test } from "vitest";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createMovieRetentionFixture } from "#testing/movie-workflow/retention-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import {
  RemovalPlanSchema,
  type FileContext,
} from "#automation/files/types.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import { MovieQuarantinePlexReceiptV2Schema } from "#shared/movie-editions/quarantine-v2.ts";
import { quarantineMovieFilesV4 } from "./quarantine.ts";

const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
type Fixture = Awaited<ReturnType<typeof createMovieRetentionFixture>>;

async function ready() {
  const f = await createMovieRetentionFixture("directors_cut", bytes);
  closers.push(f.close);
  expect(await f.warning()).toMatchObject({ status: "warning" });
  await f.deliverWarning();
  const result = await f.evaluate();
  expect(result.status).toBe("quarantine");
  if (result.decisionId === null)
    throw new Error("Actual warning omitted its physical retention decision");
  return {
    f,
    input: {
      schemaVersion: 4 as const,
      operationId: f.input.operationId,
      decisionId: result.decisionId,
      scope: f.scope,
    },
  };
}

/** Every retry is a separate Activity; no execution or allowance is renewed inside one call. */
function invocation(f: Fixture): FileContext {
  if (f.context.now === undefined)
    throw new Error("Actual retention fixture omitted independent policy time");
  const execution = testPublicationExecution();
  return {
    ...f.source.files.context,
    now: f.context.now,
    publicationExecution: () => execution,
    movieManagement: {
      execution,
      budget: new PublicationAuthorityReadBudget(),
    },
  };
}

async function databaseState(f: Fixture, decisionId: string) {
  return {
    asset: await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
      include: { subtitles: { orderBy: { id: "asc" } } },
    }),
    pointer: await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
    }),
    decision: await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: decisionId },
    }),
    operation: await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    }),
    publication: await f.db.operation.findUniqueOrThrow({
      where: { id: f.publicationOperationId },
    }),
  };
}

async function fileState(f: Fixture) {
  const subtitles = await f.db.subtitleAsset.findMany({
    where: { assetId: f.asset.id, state: "installed", storageKind: "sidecar" },
    orderBy: { id: "asc" },
  });
  expect(subtitles.map((subtitle) => subtitle.language).sort()).toEqual([
    "en",
    "zh-Hans",
  ]);
  const files = [
    {
      id: f.asset.id,
      path: workerFilePath(f.source.files.context, f.asset.path),
    },
    ...subtitles.map((subtitle) => {
      if (subtitle.path === null)
        throw new Error("Actual caption omitted its installed path");
      return {
        id: subtitle.id,
        path: workerFilePath(f.source.files.context, subtitle.path),
      };
    }),
  ];
  return Promise.all(
    files.map(async (file) => ({
      ...file,
      bytes: await readFile(file.path),
    })),
  );
}

async function physicalJournals(
  f: Fixture,
  decisionId: string,
  original: Awaited<ReturnType<typeof fileState>>,
) {
  const decision = await f.db.retentionDecision.findUniqueOrThrow({
    where: { id: decisionId },
  });
  const entry = RemovalPlanSchema.parse(decision.manifest).assets[0];
  if (entry === undefined)
    throw new Error("Physical quarantine lost its manifest");
  expect(entry.sidecars).toHaveLength(2);
  const files = [
    { id: entry.assetId, ...entry },
    ...entry.sidecars.map((sidecar) => ({
      id: sidecar.subtitleId,
      ...sidecar,
    })),
  ];
  const journals = [];
  for (const file of files) {
    const source = original.find((value) => value.id === file.id);
    if (source === undefined)
      throw new Error("Quarantine manifest invented a file");
    await expect(access(source.path)).rejects.toMatchObject({ code: "ENOENT" });
    const target = path.join(
      f.source.files.roots.movies.control,
      "quarantine",
      file.quarantineId,
    );
    expect(await readFile(target)).toEqual(source.bytes);
    const operationId = `${f.input.operationId}-quarantine-${file.quarantineId}`;
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
      kind: "quarantine",
      phase: "complete",
      source: source.path,
      target,
      sha256: file.checksum,
    });
    journals.push(literal);
  }
  return journals;
}

test("a database failure after all real quarantine journals completes recovers the same manifest in a new Activity", async () => {
  const { f, input } = await ready();
  const before = await databaseState(f, input.decisionId);
  const files = await fileState(f);
  const failure = new Error(
    "Synthetic database failure after physical quarantine",
  );
  let injected = false;
  const db = queryFixtureDatabase(f.db, {
    query: {
      retentionDecision: {
        update({ args, query }) {
          if (args.data.state === "quarantined") {
            injected = true;
            throw failure;
          }
          return query(args);
        },
      },
    },
  });
  await expect(
    quarantineMovieFilesV4({ ...invocation(f), db }, input),
  ).rejects.toBe(failure);
  expect(injected).toBe(true);
  const interrupted = await databaseState(f, input.decisionId);
  expect(interrupted.asset).toEqual(before.asset);
  expect(interrupted.pointer).toEqual(before.pointer);
  expect(interrupted.operation).toEqual(before.operation);
  expect(interrupted.publication).toEqual(before.publication);
  expect(interrupted.decision).toMatchObject({
    state: before.decision.state,
    version: before.decision.version,
    evidence: before.decision.evidence,
    quarantinedAt: null,
    purgeAfter: null,
  });
  const journals = await physicalJournals(f, input.decisionId, files);
  expect(journals).toHaveLength(3);
  await quarantineMovieFilesV4(invocation(f), input);
  const completed = await databaseState(f, input.decisionId);
  expect(completed.decision).toMatchObject({
    state: "quarantined",
    version: before.decision.version + 1,
    manifest: interrupted.decision.manifest,
    evidence: before.decision.evidence,
  });
  expect(completed.asset).toMatchObject({
    state: "quarantined",
    version: before.asset.version + 1,
  });
  expect(completed.pointer).toMatchObject({
    evidenceId: null,
    associationHash: null,
    revision: before.pointer.revision + 1,
  });
  expect(completed.publication).toEqual(before.publication);
  expect(await physicalJournals(f, input.decisionId, files)).toEqual(journals);
  expect(
    MovieQuarantinePlexReceiptV2Schema.parse(
      z
        .object({
          movieQuarantinePlexReceiptV2: z.unknown(),
        })
        .parse(completed.operation.result).movieQuarantinePlexReceiptV2,
    ),
  ).toMatchObject({
    operationId: input.operationId,
    decisionId: input.decisionId,
    scope: input.scope,
  });
}, 60_000);

test.each(["allowance", "scope"] as const)(
  "the original physical %s guard cannot create a manifest or move bytes",
  async (change) => {
    const { f, input } = await ready();
    const before = await databaseState(f, input.decisionId);
    expect(before.decision.manifest).toBeNull();
    const files = await fileState(f);
    const context = invocation(f);
    const budget = context.movieManagement?.budget;
    if (budget === undefined)
      throw new Error("Physical invocation allowance missing");
    if (change === "allowance") budget.consume(99);
    const selected =
      change === "scope"
        ? {
            ...input,
            scope: { ...input.scope, edition: "extended_cut" as const },
          }
        : input;
    const effect = quarantineMovieFilesV4(context, selected);
    if (change === "allowance") {
      await expect(effect).rejects.toMatchObject({
        code: "archive_transition_reconciliation_required",
      });
      expect(() => budget.consume(0)).toThrow("100 total queried records");
    } else
      await expect(effect).rejects.toMatchObject({ reason: "scope_changed" });
    expect(await databaseState(f, input.decisionId)).toEqual(before);
    expect(await fileState(f)).toEqual(files);
    const journals = await readdir(
      path.join(f.source.files.roots.movies.control, "journal"),
    );
    expect(
      journals.filter((name) =>
        name.startsWith(`${input.operationId}-quarantine-`),
      ),
    ).toEqual([]);
  },
  60_000,
);
