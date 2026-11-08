import { afterEach, beforeAll, expect, test } from "vitest";
import { access, lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { createMovieRetentionFixture } from "#testing/movie-workflow/retention-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import {
  MovieRestoreReceiptEnvelopeV1Schema,
  type MovieRestoreReceiptV1,
} from "#shared/movie-editions/restore-v1.ts";
import { snapshotMoviePublicationAssetV2 } from "#infrastructure/movie-editions/publication/snapshot.ts";
import { findMoviePublicationReferenceV2 } from "#infrastructure/movie-editions/publication/store.ts";
import { loadMovieRestorePublicationParentV1 } from "#infrastructure/movie-editions/publication/restore-records.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
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

async function ready(edition: MovieEditionKey, otherCut = false) {
  const f = await createMovieRetentionFixture(edition, bytes);
  closers.push(f.close);
  const otherEdition: MovieEditionKey =
    edition === "directors_cut" ? "final_cut" : "directors_cut";
  if (otherCut) {
    await requestTestMovieV4(
      f.db,
      f.source.user,
      f.scope.mediaId,
      otherEdition,
    );
    await f.db.retentionHold.create({
      data: {
        userId: f.source.user.id,
        mediaId: f.scope.mediaId,
        edition: otherEdition,
        isPin: true,
      },
    });
  }
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
    edition,
  );
  const command = await f.db.operation.findUniqueOrThrow({
    where: { id: request.input.operationId },
  });
  expect(command.kind).toBe("restore_movie_edition_v4");
  return {
    f,
    input: request.input,
    decisionId: result.decisionId,
    otherEdition,
  };
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
    quarantine: await f.db.operation.findUniqueOrThrow({
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
    attempts: await f.db.acquisitionAttempt.findMany({
      where: { mediaIds: { has: f.scope.mediaId } },
      orderBy: { id: "asc" },
    }),
    torrents: await f.db.torrent.findMany({ orderBy: { id: "asc" } }),
  };
}

async function otherScope(f: Fixture, edition: MovieEditionKey) {
  const where = { mediaId: f.scope.mediaId, edition };
  return {
    target: await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: where },
    }),
    requests: await f.db.mediaRequest.findMany({ where }),
    holds: await f.db.retentionHold.findMany({ where }),
  };
}

async function quarantinedFiles(f: Fixture, decisionId: string) {
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

async function assertImmutableRestoreCommand(
  f: Fixture,
  operationId: string,
  original: unknown,
) {
  await expect(
    f.db
      .$executeRaw`UPDATE "Operation" SET result=result-'movieRestoreReceiptV1' WHERE id=${operationId}`,
  ).rejects.toThrow("immutable");
  await expect(
    f.db
      .$executeRaw`UPDATE "Operation" SET payload=jsonb_set(payload,'{scope,edition}','"extended_cut"'::jsonb) WHERE id=${operationId}`,
  ).rejects.toThrow("immutable");
  expect(
    await f.db.operation.findUniqueOrThrow({ where: { id: operationId } }),
  ).toEqual(original);
}

async function assertRestoredPublicationReference(
  f: Fixture,
  receipt: MovieRestoreReceiptV1,
) {
  const budget = new PublicationAuthorityReadBudget();
  const asset = await snapshotMoviePublicationAssetV2(
    f.db,
    f.scope,
    f.asset.id,
    budget,
  );
  expect(asset).toEqual(receipt.after);
  const reference = await findMoviePublicationReferenceV2(
    f.db,
    { scope: f.scope, asset },
    budget,
  );
  expect(reference).toMatchObject({
    kind: "movie_restore_publication_v1",
    scope: f.scope,
    assetId: f.asset.id,
    assetVersion: receipt.after.version,
    operationId: receipt.input.operationId,
    receiptHash: identityHash(receipt),
    bindingHash: identityHash(receipt.after),
    physicalEvidenceHash: identityHash({
      participants: receipt.participants,
      journals: receipt.journals,
    }),
  });
  if (reference?.kind !== "movie_restore_publication_v1")
    throw new Error(
      "Restored bytes did not resolve their actual publication parent",
    );
  const parent = await loadMovieRestorePublicationParentV1(
    f.db,
    reference,
    budget,
  );
  expect(parent.asset).toEqual(receipt.after);
  expect(parent.receipt).toEqual(receipt);
  expect(() => budget.consume(0)).not.toThrow();
}

test.each(MovieEditionKeySchema.options)(
  "%s restores its actual video and both captions at the original paths with an immutable scoped receipt",
  async (edition) => {
    const { f, input, decisionId, otherEdition } = await ready(edition, true);
    const before = await state(f, decisionId);
    const other = await otherScope(f, otherEdition);
    const original = await quarantinedFiles(f, decisionId);
    const context = invocation(f);
    const startedAt = Date.now();
    await restoreMovieFilesV4(context, input);
    expect(() => context.movieManagement.budget.consume(0)).not.toThrow();
    const command = await f.db.operation.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    const envelope = MovieRestoreReceiptEnvelopeV1Schema.parse(
      z.object({ movieRestoreReceiptV1: z.unknown() }).parse(command.result)
        .movieRestoreReceiptV1,
    );
    const { receipt } = envelope;
    expect(envelope.receiptHash).toBe(identityHash(receipt));
    await assertRestoredPublicationReference(f, receipt);
    expect(receipt).toMatchObject({
      schemaVersion: 1,
      scope: f.scope,
      input,
      quarantine: {
        operationId: f.input.operationId,
        decisionId,
        manifestHash: identityHash(before.decision.manifest),
      },
      before: {
        id: f.asset.id,
        version: f.asset.version + 1,
        state: "quarantined",
      },
      after: {
        id: f.asset.id,
        version: f.asset.version + 2,
        state: "published",
      },
    });
    expect(receipt.quarantine.receiptHash).toBe(
      identityHash(
        z
          .object({ movieQuarantinePlexReceiptV2: z.json() })
          .parse(before.quarantine.result).movieQuarantinePlexReceiptV2,
      ),
    );
    expect(receipt.participants).toHaveLength(6);
    expect(receipt.journals).toHaveLength(3);
    expect(Date.parse(receipt.committedAt)).toBeGreaterThanOrEqual(startedAt);
    expect(Date.parse(receipt.committedAt)).toBeLessThanOrEqual(Date.now());
    expect(Date.parse(receipt.expiresAt)).toBeLessThanOrEqual(
      Date.parse(receipt.observedAt) + 60_000,
    );
    for (const file of original) {
      await expect(access(file.source)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(file.target)).toEqual(file.bytes);
      const physical = await lstat(file.target, { bigint: true });
      const id = `${input.operationId}-restore-${file.quarantineId}`;
      const journalPath = path.join(
        f.source.files.roots.movies.control,
        "journal",
        `${id}.json`,
      );
      const journal = await readFile(journalPath, "utf8");
      const journalIdentity = await lstat(journalPath, { bigint: true });
      expect(ManifestSchema.parse(JSON.parse(journal))).toMatchObject({
        operationId: id,
        kind: "restore",
        phase: "complete",
        sha256: file.checksum,
        source: file.source,
        target: file.target,
      });
      expect(
        receipt.journals.find((row) => row.path === `journal/${id}.json`),
      ).toMatchObject({
        raw: journal,
        sha256: createHash("sha256").update(journal).digest("hex"),
        sizeBytes: Buffer.byteLength(journal).toString(),
        identity: {
          device: journalIdentity.dev.toString(),
          inode: journalIdentity.ino.toString(),
          mtimeNs: journalIdentity.mtimeNs.toString(),
          ctimeNs: journalIdentity.ctimeNs.toString(),
        },
      });
      expect(
        receipt.participants.filter(
          (row) =>
            row.physical.root === "library" &&
            row.physical.path === file.libraryPath,
        ),
      ).toMatchObject([
        {
          physical: {
            state: "present",
            sha256: file.checksum,
            sizeBytes: physical.size.toString(),
            identity: {
              device: physical.dev.toString(),
              inode: physical.ino.toString(),
              mtimeNs: physical.mtimeNs.toString(),
              ctimeNs: physical.ctimeNs.toString(),
            },
          },
        },
      ]);
      expect(
        receipt.participants.filter(
          (row) =>
            row.physical.root === "control" &&
            row.physical.path === `quarantine/${file.quarantineId}`,
        ),
      ).toMatchObject([{ physical: { state: "absent" } }]);
    }
    const after = await state(f, decisionId);
    expect(after.asset).toMatchObject({
      id: before.asset.id,
      state: "published",
      version: f.asset.version + 2,
      path: before.asset.path,
      plexPublishedAt: before.asset.plexPublishedAt,
      coverage: before.asset.coverage,
    });
    for (const subtitle of before.asset.subtitles)
      expect(
        after.asset.subtitles.find((row) => row.id === subtitle.id),
      ).toEqual(
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
      version: before.decision.version + 1,
      manifest: before.decision.manifest,
      quarantinedAt: before.decision.quarantinedAt,
      purgeAfter: before.decision.purgeAfter,
      evidence: {
        restoreOperationId: input.operationId,
        restoredGenerations: { [f.scope.mediaId]: input.generation },
      },
    });
    expect(after.quarantine).toEqual(before.quarantine);
    expect(after.publication).toEqual(before.publication);
    expect(after.pointer).toEqual(before.pointer);
    expect(after.history).toEqual(before.history);
    expect(after.attempts).toEqual(before.attempts);
    expect(after.torrents).toEqual(before.torrents);
    expect(f.source.wire.additions()).toBe(1);
    expect(
      await f.db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
      }),
    ).toMatchObject({ availability: "importing" });
    expect(await otherScope(f, otherEdition)).toEqual(other);
    let configured = 0;
    const acknowledgement = invocation(f);
    await restoreMovieFilesV4(
      {
        ...acknowledgement,
        enabled: {
          ...acknowledgement.enabled,
          acquisition: () => Promise.resolve(false),
        },
        permittedMovieSection: () => {
          configured++;
          return Promise.resolve("2");
        },
      },
      input,
    );
    expect(configured).toBe(0);
    expect(await state(f, decisionId)).toEqual(after);
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      }),
    ).toEqual(command);
    if (edition === "directors_cut")
      await assertImmutableRestoreCommand(f, input.operationId, command);
  },
  60_000,
);

test.each(["sdk", "generation", "bytes"] as const)(
  "%s protection cannot manufacture a restore receipt or move quarantined bytes",
  async (change) => {
    const { f, input, decisionId } = await ready("extended_cut");
    const before = await state(f, decisionId);
    const original = await quarantinedFiles(f, decisionId);
    if (change === "generation")
      await requestTestMovieV4(
        f.db,
        f.source.user,
        f.scope.mediaId,
        f.scope.edition,
      );
    if (change === "bytes") {
      const video = original[0];
      if (video === undefined)
        throw new Error("Actual quarantined video missing");
      await writeFile(
        video.source,
        Buffer.concat([video.bytes, Buffer.from("\nSynthetic damaged bytes")]),
      );
    }
    const retained = await quarantinedFiles(f, decisionId);
    const context = invocation(f);
    const execution = context.movieManagement.execution;
    const expiry = new Error(
      "Original restore SDK expired after actual content hashing",
    );
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
      await expect(restoreMovieFilesV4(active, input)).rejects.toBe(expiry);
    else await expect(restoreMovieFilesV4(active, input)).rejects.toThrow();
    expect(expired).toBe(change === "sdk");
    expect(await state(f, decisionId)).toEqual(before);
    expect(await quarantinedFiles(f, decisionId)).toEqual(retained);
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      }),
    ).toMatchObject({ result: null });
    const names = await readdir(
      path.join(f.source.files.roots.movies.control, "journal"),
    );
    const restoreJournals = names.filter((name) =>
      name.startsWith(`${input.operationId}-restore-`),
    );
    if (change !== "bytes") expect(restoreJournals).toEqual([]);
    for (const filename of restoreJournals)
      expect(
        ManifestSchema.parse(
          JSON.parse(
            await readFile(
              path.join(
                f.source.files.roots.movies.control,
                "journal",
                filename,
              ),
              "utf8",
            ),
          ),
        ).phase,
      ).toBe("prepared");
  },
  60_000,
);
