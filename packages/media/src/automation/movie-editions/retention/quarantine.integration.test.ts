import { afterEach, beforeAll, expect, test } from "vitest";
import { access, readFile, readdir } from "node:fs/promises";
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
import { MovieQuarantinePlexReceiptV2Schema } from "#shared/movie-editions/quarantine-v2.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
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

async function ready(edition: MovieEditionKey, includeOther = false) {
  const f = await createMovieRetentionFixture(edition, bytes);
  closers.push(f.close);
  const otherEdition: MovieEditionKey =
    edition === "directors_cut" ? "final_cut" : "directors_cut";
  if (includeOther) {
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
  const warning = await f.warning();
  expect(warning.status).toBe("warning");
  await f.deliverWarning();
  const evaluation = await f.evaluate();
  expect(evaluation.status).toBe("quarantine");
  if (evaluation.decisionId === null || f.context.now === undefined)
    throw new Error(
      "Actual retention producer omitted its quarantine authority",
    );
  const execution = testPublicationExecution();
  return {
    f,
    input: {
      schemaVersion: 4 as const,
      operationId: f.input.operationId,
      decisionId: evaluation.decisionId,
      scope: f.scope,
    },
    context: {
      ...f.source.files.context,
      now: f.context.now,
      publicationExecution: () => execution,
      movieManagement: {
        execution,
        budget: new PublicationAuthorityReadBudget(),
      },
    },
    execution,
    otherEdition,
  };
}

async function otherScope(f: Fixture, edition: MovieEditionKey) {
  const selected = { mediaId: f.scope.mediaId, edition };
  return {
    target: await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: selected },
    }),
    requests: await f.db.mediaRequest.findMany({ where: selected }),
    holds: await f.db.retentionHold.findMany({ where: selected }),
    decisions: await f.db.retentionDecision.findMany({ where: selected }),
  };
}

async function physical(f: Fixture) {
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
    include: { subtitles: { orderBy: { id: "asc" } } },
  });
  const sidecars = asset.subtitles.filter(
    (subtitle) =>
      subtitle.storageKind === "sidecar" && subtitle.state === "installed",
  );
  expect(sidecars.map((subtitle) => subtitle.language).sort()).toEqual([
    "en",
    "zh-Hans",
  ]);
  const files = [
    {
      id: asset.id,
      source: workerFilePath(f.source.files.context, asset.path),
    },
    ...sidecars.map((subtitle) => {
      if (subtitle.path === null)
        throw new Error("Actual installed caption omitted its physical path");
      return {
        id: subtitle.id,
        source: workerFilePath(f.source.files.context, subtitle.path),
      };
    }),
  ];
  return {
    asset,
    sidecars,
    files: await Promise.all(
      files.map(async (file) => ({
        ...file,
        bytes: await readFile(file.source),
      })),
    ),
    pointer: await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
    }),
    publication: await f.db.operation.findUniqueOrThrow({
      where: { id: f.publicationOperationId },
    }),
  };
}

async function assertUnmoved(
  f: Fixture,
  before: Awaited<ReturnType<typeof physical>>,
) {
  expect(await physical(f)).toEqual(before);
  expect(
    await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    }),
  ).toMatchObject({ result: null });
  const journals = await readdir(
    path.join(f.source.files.roots.movies.control, "journal"),
  );
  expect(
    journals.filter((name) =>
      name.startsWith(`${f.input.operationId}-quarantine-`),
    ),
  ).toEqual([]);
}

async function assertMoves(
  f: Fixture,
  decisionId: string,
  before: Awaited<ReturnType<typeof physical>>,
) {
  const decision = await f.db.retentionDecision.findUniqueOrThrow({
    where: { id: decisionId },
  });
  const entries = RemovalPlanSchema.parse(decision.manifest).assets;
  expect(entries).toHaveLength(1);
  const entry = entries[0];
  if (entry === undefined) throw new Error("Actual quarantine lost its video");
  expect(entry.sidecars).toHaveLength(2);
  const moved = [
    { id: entry.assetId, ...entry },
    ...entry.sidecars.map((sidecar) => ({
      id: sidecar.subtitleId,
      ...sidecar,
    })),
  ];
  for (const file of moved) {
    const original = before.files.find((candidate) => candidate.id === file.id);
    if (original === undefined) throw new Error("Quarantine invented a file");
    const target = path.join(
      f.source.files.roots.movies.control,
      "quarantine",
      file.quarantineId,
    );
    await expect(access(original.source)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(target)).toEqual(original.bytes);
    const operationId = `${f.input.operationId}-quarantine-${file.quarantineId}`;
    const journal = ManifestSchema.parse(
      JSON.parse(
        await readFile(
          path.join(
            f.source.files.roots.movies.control,
            "journal",
            `${operationId}.json`,
          ),
          "utf8",
        ),
      ),
    );
    expect(journal).toMatchObject({
      operationId,
      kind: "quarantine",
      phase: "complete",
      sha256: file.checksum,
      source: original.source,
      target,
    });
  }
  const current = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
    include: { subtitles: { orderBy: { id: "asc" } } },
  });
  expect(current).toMatchObject({
    path: before.asset.path,
    state: "quarantined",
    edition: f.scope.edition,
    version: before.asset.version + 1,
  });
  for (const original of before.asset.subtitles) {
    const subtitle = current.subtitles.find((row) => row.id === original.id);
    expect(subtitle).toEqual(
      original.state === "installed"
        ? {
            ...original,
            state: "quarantined",
            videoVersion: current.version,
            version: original.version + 1,
          }
        : original,
    );
  }
  expect(
    await f.db.operation.findUniqueOrThrow({
      where: { id: f.publicationOperationId },
    }),
  ).toEqual(before.publication);
  return decision;
}

test.each(MovieEditionKeySchema.options)(
  "%s physically quarantines its actual video and both caption files with a scoped immutable receipt",
  async (edition) => {
    const { f, input, context, otherEdition } = await ready(edition, true);
    const before = await physical(f);
    const other = await otherScope(f, otherEdition);
    const projection = await f.db.retentionPlexProjection.findUniqueOrThrow({
      where: { decisionId: input.decisionId },
    });
    const startedAt = Date.now();
    await quarantineMovieFilesV4(context, input);
    const decision = await assertMoves(f, input.decisionId, before);
    if (decision.quarantinedAt === null || decision.purgeAfter === null)
      throw new Error("Actual quarantine omitted its real retention clocks");
    expect(decision.quarantinedAt.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(decision.quarantinedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(
      decision.purgeAfter.getTime() - decision.quarantinedAt.getTime(),
    ).toBe(7 * 86_400_000);
    const operation = await f.db.operation.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    const receipt = MovieQuarantinePlexReceiptV2Schema.parse(
      z
        .object({
          movieQuarantinePlexReceiptV2: z.unknown(),
        })
        .parse(operation.result).movieQuarantinePlexReceiptV2,
    );
    expect(receipt).toMatchObject({
      scope: f.scope,
      operationId: input.operationId,
      decisionId: input.decisionId,
      manifestHash: identityHash(decision.manifest),
      committedAt: decision.quarantinedAt.toISOString(),
      decisions: [{ projectionHash: projection.projectionHash }],
      bindings: [
        {
          evidenceId: before.pointer.evidenceId,
          revision: before.pointer.revision,
        },
      ],
    });
    expect(
      await f.db.plexBindingCurrent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
      }),
    ).toMatchObject({
      evidenceId: null,
      associationHash: null,
      revision: before.pointer.revision + 1,
    });
    expect(
      await f.db.plexClaimGroup.count({
        where: { group: { path: ["assetId"], equals: f.asset.id } },
      }),
    ).toBe(0);
    expect(
      await f.db.retentionPlexProjection.findUniqueOrThrow({
        where: { decisionId: input.decisionId },
      }),
    ).toEqual(projection);
    expect(await otherScope(f, otherEdition)).toEqual(other);
    if (edition === "directors_cut") {
      await expect(
        f.db
          .$executeRaw`UPDATE "Operation" SET result=result-'movieQuarantinePlexReceiptV2' WHERE id=${input.operationId}`,
      ).rejects.toThrow("immutable");
      await expect(
        f.db
          .$executeRaw`UPDATE "Operation" SET result=jsonb_set(result,'{movieQuarantinePlexReceiptV2,scope,edition}','"extended_cut"'::jsonb) WHERE id=${input.operationId}`,
      ).rejects.toThrow("immutable");
      await expect(
        f.db
          .$executeRaw`UPDATE "Operation" SET payload=jsonb_set(payload,'{scope,edition}','"extended_cut"'::jsonb) WHERE id=${input.operationId}`,
      ).rejects.toThrow("immutable");
      expect(
        await f.db.operation.findUniqueOrThrow({
          where: { id: input.operationId },
        }),
      ).toEqual(operation);
    }
  },
  60_000,
);

test.each(["keep", "generation", "sdk"] as const)(
  "%s protection before the physical movie effect preserves video, captions and original publication",
  async (change) => {
    const { f, input, context, execution } = await ready("extended_cut");
    const before = await physical(f);
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
    const expiry = new Error(
      "Original movie quarantine SDK expired after hashing",
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
      await expect(quarantineMovieFilesV4(active, input)).rejects.toBe(expiry);
    else await expect(quarantineMovieFilesV4(active, input)).rejects.toThrow();
    expect(expired).toBe(change === "sdk");
    await assertUnmoved(f, before);
  },
  60_000,
);
