import { afterEach, beforeAll, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createPublishedMovieFixture } from "#testing/movie-workflow/upgrade-fixture.ts";
import { authenticateMovieFixtureOwner } from "#testing/movie-workflow/owner-pin.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { readMovieTargetContextV4 } from "#infrastructure/movie-editions/lifecycle/target-view.ts";
import { MovieLifecycleCommandV4Schema } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { evaluateMovieRetentionV4 } from "#automation/movie-editions/retention/evaluate.ts";
import { quarantineMovieFilesV4 } from "#automation/movie-editions/retention/quarantine.ts";
import { purgeMovieFilesV4 } from "#automation/movie-editions/retention/purge.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { queueOperation } from "#automation/store.ts";

let bytes: Uint8Array;
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
const accessScope = { serverMachineId: "fixture-server", movieSectionId: "1" };
const digest = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

async function ready(edition: MovieEditionKey) {
  const f = await createPublishedMovieFixture(edition, bytes);
  closers.push(f.close);
  const { db, context } = f.source;
  const originalOwner = await db.mediaUser.findFirstOrThrow({
    where: { role: "owner" },
  });
  const owner = await authenticateMovieFixtureOwner(context, {
    ...originalOwner,
    role: "owner",
  });
  const commands = new MovieLifecycleCommands(db, {
    keepDays: 7,
    ...accessScope,
  });
  const otherEdition =
    edition === "directors_cut" ? "final_cut" : "directors_cut";
  await requestTestMovieV4(db, f.source.user, f.scope.mediaId, otherEdition);
  const sibling = await db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.scope.mediaId, edition: otherEdition },
    },
  });
  const before = {
    asset: await db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
      include: { subtitles: { orderBy: { id: "asc" } } },
    }),
    publication: await db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    }),
    requests: await db.mediaRequest.findMany({
      where: { mediaId: f.scope.mediaId },
      orderBy: { id: "asc" },
    }),
    choices: await db.movieEditionChoice.findMany({
      where: { rootMediaId: f.scope.mediaId },
      orderBy: { id: "asc" },
    }),
    watches: await db.plexWatchProjection.findMany({
      where: { mediaId: f.scope.mediaId },
      orderBy: { userId: "asc" },
    }),
    warnings: await db.applicationEvent.findMany({
      where: { mediaId: f.scope.mediaId, kind: "retention_warning" },
    }),
  };
  const view = await db.$transaction((tx) =>
    readMovieTargetContextV4(tx, owner, {
      scope: f.scope,
      access: accessScope,
    }),
  );
  if (view.access !== "detail" || view.removalConfirmation === null)
    throw new Error("Actual serving video has no owner review confirmation");
  const command = MovieLifecycleCommandV4Schema.parse({
    schemaVersion: 4,
    scope: f.scope,
    expected: view.expected,
    command: { action: "remove", confirmation: view.removalConfirmation },
  });
  const key = crypto.randomUUID();
  const result = await commands.executeMovieLifecycleV4(owner, key, command);
  if (result.result.operationId === undefined)
    throw new Error("Owner removal omitted its real scoped outbox command");
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: result.result.operationId },
  });
  const input = MovieOperationV4Schema.parse(
    z.object(MovieOperationV4Schema.shape).parse(operation.payload),
  );
  return {
    f,
    db,
    owner,
    commands,
    sibling,
    before,
    command,
    key,
    result,
    input,
  };
}

function files(
  f: Awaited<ReturnType<typeof ready>>["f"],
  budget = new PublicationAuthorityReadBudget(),
) {
  const execution = testPublicationExecution();
  return {
    ...f.source.files.context,
    publicationExecution: () => execution,
    movieManagement: { execution, budget },
  };
}

async function authorize(f: Awaited<ReturnType<typeof ready>>) {
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  const result = await evaluateMovieRetentionV4(
    { ...f.f.source.context, movieManagement: { execution, budget } },
    f.input,
    execution,
  );
  expect(result).toMatchObject({
    status: "quarantine",
    reason: "owner_confirmed_removal",
  });
  if (result.decisionId === null)
    throw new Error("Owner removal omitted its actual native decision");
  return {
    schemaVersion: 4 as const,
    operationId: f.input.operationId,
    decisionId: result.decisionId,
    scope: f.input.scope,
  };
}

for (const edition of MovieEditionKeySchema.options) {
  test(`actual owner ${edition} removal quarantines all three owned files without creating watch or warning consent`, async () => {
    const f = await ready(edition);
    const input = await authorize(f);
    const beforeDecision = await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: input.decisionId },
      include: { plexProjection: true },
    });
    expect(beforeDecision).toMatchObject({
      state: "grace_period",
      warningAcceptedAt: null,
      evidence: { ownerRemovalV1: { operationId: f.input.operationId } },
      plexProjection: { decisionId: input.decisionId },
    });
    expect(beforeDecision.evidence).not.toHaveProperty("warningEventId");
    await quarantineMovieFilesV4(files(f.f), input);
    const decision = await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: input.decisionId },
    });
    expect(decision).toMatchObject({
      state: "quarantined",
      warningAcceptedAt: null,
    });
    const entry = RemovalPlanSchema.parse(decision.manifest).assets[0];
    if (entry === undefined)
      throw new Error("Owner quarantine omitted its actual video manifest");
    expect(entry.sidecars).toHaveLength(2);
    for (const file of [
      { id: entry.assetId, ...entry },
      ...entry.sidecars.map((row) => ({ id: row.subtitleId, ...row })),
    ]) {
      const original =
        file.id === f.before.asset.id
          ? f.before.asset
          : f.before.asset.subtitles.find((row) => row.id === file.id);
      if (original?.path == null)
        throw new Error("Actual original file omitted its path");
      const originalPath = workerFilePath(
        f.f.source.files.context,
        original.path,
      );
      await expect(access(originalPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      const target = path.join(
        f.f.source.files.roots.movies.control,
        "quarantine",
        file.quarantineId,
      );
      const moved = await readFile(target);
      expect(digest(moved)).toBe(file.checksum);
      const journalId = `${input.operationId}-quarantine-${file.quarantineId}`;
      expect(
        ManifestSchema.parse(
          JSON.parse(
            await readFile(
              path.join(
                f.f.source.files.roots.movies.control,
                "journal",
                `${journalId}.json`,
              ),
              "utf8",
            ),
          ),
        ),
      ).toMatchObject({
        operationId: journalId,
        kind: "quarantine",
        phase: "complete",
        sha256: file.checksum,
        source: originalPath,
        target,
      });
    }
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: f.f.input.operationId },
      }),
    ).toEqual(f.before.publication);
    expect(
      await f.db.mediaRequest.findMany({
        where: { mediaId: f.f.scope.mediaId },
        orderBy: { id: "asc" },
      }),
    ).toEqual(f.before.requests);
    expect(
      await f.db.movieEditionChoice.findMany({
        where: { rootMediaId: f.f.scope.mediaId },
        orderBy: { id: "asc" },
      }),
    ).toEqual(f.before.choices);
    expect(
      await f.db.plexWatchProjection.findMany({
        where: { mediaId: f.f.scope.mediaId },
        orderBy: { userId: "asc" },
      }),
    ).toEqual(f.before.watches);
    expect(
      await f.db.applicationEvent.findMany({
        where: { mediaId: f.f.scope.mediaId, kind: "retention_warning" },
      }),
    ).toEqual(f.before.warnings);
    expect(
      await f.db.mediaIntent.findUniqueOrThrow({
        where: {
          mediaId_edition: {
            mediaId: f.f.scope.mediaId,
            edition: f.sibling.edition,
          },
        },
      }),
    ).toEqual(f.sibling);
    const execution = testPlexBindingExecution();
    expect(
      await evaluateMovieRetentionV4(f.f.source.context, f.input, execution),
    ).toMatchObject({
      status: "complete",
      reason: "owner_confirmed_quarantine",
    });
    await expect(purgeMovieFilesV4(files(f.f), input)).rejects.toMatchObject({
      reason: "owner_removal_requires_retention_consent",
    });
    expect(
      await f.commands.executeMovieLifecycleV4(f.owner, f.key, f.command, () =>
        Promise.reject(new Error("Committed owner command must ACK first")),
      ),
    ).toEqual(f.result);
  }, 60_000);
}

test("a later ordinary retain command cannot turn owner quarantine into permanent purge authority", async () => {
  const f = await ready("directors_cut");
  const input = await authorize(f);
  await quarantineMovieFilesV4(files(f.f), input);
  const id = await f.db.$transaction((tx) =>
    queueOperation(tx, {
      key: `actual-later-retain:${crypto.randomUUID()}`,
      kind: "retain_movie_edition_v4",
      targetId: f.input.mediaId,
      payload: {
        schemaVersion: 4,
        scope: f.input.scope,
        mediaId: f.input.mediaId,
        generation: f.input.generation,
      },
    }),
  );
  const operation = await f.db.operation.findUniqueOrThrow({ where: { id } });
  const later = MovieOperationV4Schema.parse(
    z.object(MovieOperationV4Schema.shape).parse(operation.payload),
  );
  expect(
    await evaluateMovieRetentionV4(
      {
        ...f.f.source.context,
        now: () => new Date(Date.now() + 8 * 86_400_000),
      },
      later,
      testPlexBindingExecution(),
    ),
  ).toMatchObject({
    status: "protected",
    reason: "owner_removal_requires_retention_consent",
  });
  expect(
    await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: input.decisionId },
    }),
  ).toMatchObject({ state: "quarantined", warningAcceptedAt: null });
}, 60_000);
