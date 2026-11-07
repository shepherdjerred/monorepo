import { randomBytes } from "node:crypto";
import { beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { PirateBayProvider } from "#integrations/providers.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { CancelMovieRequestV4Schema } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import { LIBRARY_MOVIE_DUE_CURSOR } from "./library-movies.ts";
import { PERSONAL_MOVIE_DUE_CURSOR } from "./personal-movie-due.ts";

let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});

async function fixture(edition: MovieEditionKey) {
  const f = await createMovieWorkflowFixture(edition, { bytes });
  const db = f.source.db;
  await db.mediaProvider.update({
    where: { id: "knaben" },
    data: { enabled: false },
  });
  await db.mediaProvider.create({
    data: {
      id: "thepiratebay",
      enabled: true,
      seedingPolicy: { kind: "public" },
    },
  });
  let visible = false;
  let searches = 0;
  const hash = randomBytes(20).toString("hex");
  const name = `Workflow.Fixture.2020.${MOVIE_EDITION_REGISTRY[edition].plexLabel.replaceAll(" ", ".")}.1080p.WEB-DL.H264.ENG`;
  const provider = new PirateBayProvider((url) => {
    expect(url.pathname).toBe("/q.php");
    searches++;
    return Promise.resolve(
      Response.json(
        visible
          ? [
              {
                id: "910001",
                name,
                info_hash: hash,
                size: bytes.byteLength,
                seeders: 3,
              },
            ]
          : [],
      ),
    );
  });
  const context = {
    ...f.source.context,
    providers: {
      withProvider: <T>(
        id: string,
        work: (client: PirateBayProvider) => Promise<T>,
      ) => {
        expect(id).toBe("thepiratebay");
        return work(provider);
      },
    },
  };
  const sweep = (
    cursor: string | null,
    budget = new PublicationAuthorityReadBudget(),
  ) =>
    createSweepActivities({
      ...context,
      movieManagement: { execution: testPlexBindingExecution(), budget },
    }).sweepMediaWork({ kind: "due", cursor, sweepId: crypto.randomUUID() });
  const pending = () =>
    db.operation.findMany({
      where: { idempotencyKey: { startsWith: "personal-movie-due-v4:" } },
      include: { outbox: true },
    });
  const source = async () => ({
    requests: await db.mediaRequest.findMany({
      where: { mediaId: f.input.mediaId },
    }),
    choices: await db.movieEditionChoice.findMany({
      where: { rootMediaId: f.input.mediaId },
    }),
    target: await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.input.mediaId, edition } },
    }),
    original: await db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    }),
  });
  return {
    f,
    db,
    context,
    sweep,
    pending,
    source,
    searches: () => searches,
    show: () => {
      visible = true;
    },
  };
}

for (const edition of MovieEditionKeySchema.options.filter(
  (key) => key !== "default",
)) {
  test(`actual ${edition} personal demand resumes a search-only provider from a new due command after an empty first search`, async () => {
    const h = await fixture(edition);
    const { f, db } = h;
    try {
      const movie = createMovieNetworkFacetV4(h.context);
      expect(
        await movie.reconcileMovieIntentV4(f.input, testPlexBindingExecution()),
      ).toEqual({
        status: "waiting",
        attemptId: null,
        reason: "no_acceptable_release",
      });
      await f.finishMediaOperation({
        operationId: f.input.operationId,
        status: "completed",
        reason: "no_acceptable_release",
      });
      const original = await h.source();
      expect(await db.mediaHandoffReceipt.count()).toBe(0);
      expect(await h.sweep(`${LIBRARY_MOVIE_DUE_CURSOR}start`)).toEqual({
        processed: 1,
        nextCursor: `${PERSONAL_MOVIE_DUE_CURSOR}start`,
      });
      expect(await h.pending()).toEqual([]);
      expect(await h.sweep(`${PERSONAL_MOVIE_DUE_CURSOR}start`)).toEqual({
        processed: 1,
        nextCursor: null,
      });
      await h.sweep(`${PERSONAL_MOVIE_DUE_CURSOR}start`);
      const queued = await h.pending();
      expect(queued).toHaveLength(1);
      const operation = queued[0];
      if (operation === undefined)
        throw new Error("Actual due outbox was absent");
      expect(operation.id).not.toBe(f.input.operationId);
      expect(operation).toMatchObject({
        kind: "reconcile_movie_edition_v4",
        userId: f.source.user.id,
        targetId: f.input.mediaId,
      });
      expect(operation.outbox).toMatchObject({
        kind: operation.kind,
        operationId: operation.id,
        payload: operation.payload,
      });
      const input = MovieOperationV4Schema.parse(
        z.object(MovieOperationV4Schema.shape).parse(operation.payload),
      );
      expect(input).toMatchObject({
        scope: f.input.scope,
        generation: f.input.generation,
      });
      expect(h.searches()).toBe(1);
      expect(await h.source()).toEqual(original);
      h.show();
      const result = await movie.reconcileMovieIntentV4(
        input,
        testPlexBindingExecution(),
      );
      expect(result.status).toBe("acquire");
      const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: z.uuid().parse(result.attemptId) },
        include: { release: true },
      });
      expect(attempt).toMatchObject({
        edition,
        operationId: operation.id,
        sponsorRequestId: original.requests[0]?.id,
        release: { providerId: "thepiratebay" },
      });
      expect(await db.acquisitionAttempt.count()).toBe(1);
      expect(h.searches()).toBe(2);
      expect(f.source.wire.additions()).toBe(0);
      expect(f.source.wire.control.deletes).toBe(0);
      expect(
        await db.movieEditionChoice.findMany({
          where: { rootMediaId: f.input.mediaId },
        }),
      ).toEqual(original.choices);
      expect(
        await db.operation.findUniqueOrThrow({
          where: { id: f.input.operationId },
        }),
      ).toEqual(original.original);
    } finally {
      await f.close();
    }
  }, 60_000);
}

test("the actual due phase protects the original99-spent allowance without queuing or searching", async () => {
  const h = await fixture("directors_cut");
  try {
    const original = await h.source();
    const budget = new PublicationAuthorityReadBudget();
    budget.consume(99);
    expect(await h.sweep(`${PERSONAL_MOVIE_DUE_CURSOR}start`, budget)).toEqual({
      processed: 1,
      nextCursor: null,
    });
    expect(budget.take).toBeLessThanOrEqual(0);
    expect(await h.pending()).toEqual([]);
    expect(h.searches()).toBe(0);
    expect(await h.source()).toEqual(original);
    expect(
      await h.db.applicationEvent.count({
        where: {
          kind: "personal_movie_due_protected",
          mediaId: h.f.input.mediaId,
        },
      }),
    ).toBe(1);
    expect(h.f.source.wire.additions()).toBe(0);
  } finally {
    await h.f.close();
  }
}, 60_000);

test("actual self cancellation removes scheduled personal search authority without changing its historical choice", async () => {
  const h = await fixture("directors_cut");
  const { f, db } = h;
  try {
    const before = await h.source();
    const request = before.requests[0];
    const choice = before.choices[0];
    if (request === undefined || choice === undefined)
      throw new Error("Real choice was absent");
    const commands = new MovieLifecycleCommands(db, {
      keepDays: 30,
      serverMachineId: "fixture-server",
      movieSectionId: "1",
    });
    await commands.cancelMovieEditionRequestV4(
      f.source.user,
      crypto.randomUUID(),
      CancelMovieRequestV4Schema.parse({
        schemaVersion: 4,
        scope: f.input.scope,
        subjectUserId: f.source.user.id,
        requestId: request.id,
        action: "cancel_request",
        expected: {
          targetVersion: before.target.version,
          requestVersion: request.version,
          choiceRevision: choice.choiceRevision,
        },
      }),
    );
    const cancelled = await h.source();
    await h.sweep(`${PERSONAL_MOVIE_DUE_CURSOR}start`);
    expect(await h.pending()).toEqual([]);
    expect(h.searches()).toBe(0);
    expect(await h.source()).toEqual(cancelled);
    expect(cancelled.choices).toEqual(before.choices);
    expect(f.source.wire.additions()).toBe(0);
  } finally {
    await f.close();
  }
}, 60_000);

test("the due phase retains its original SDK cancellation through awaited configuration before any outbox write", async () => {
  const h = await fixture("directors_cut");
  try {
    const original = await h.source();
    const budget = new PublicationAuthorityReadBudget();
    const sdk = testPlexBindingExecution();
    const controller = new AbortController();
    const execution = {
      ...sdk,
      signal: controller.signal,
      assertActive: () => {
        sdk.assertActive();
        controller.signal.throwIfAborted();
      },
    };
    const activities = createSweepActivities({
      ...h.context,
      movieManagement: { execution, budget },
      permittedSections: async () => {
        const sections = await h.context.permittedSections();
        controller.abort(
          new Error("Original due SDK invocation was cancelled"),
        );
        return sections;
      },
    });
    await expect(
      activities.sweepMediaWork({
        kind: "due",
        cursor: `${PERSONAL_MOVIE_DUE_CURSOR}start`,
        sweepId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("Original due SDK invocation was cancelled");
    expect(await h.pending()).toEqual([]);
    expect(h.searches()).toBe(0);
    expect(await h.source()).toEqual(original);
    expect(h.f.source.wire.additions()).toBe(0);
  } finally {
    await h.f.close();
  }
}, 60_000);
