import { randomBytes } from "node:crypto";
import { beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { submitMovieTorrentV4 } from "#automation/movie-editions/submission.ts";
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
import { MovieAcquisitionIdentityV2Schema } from "#shared/movie-editions/acquisition-v2.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { LIBRARY_MOVIE_DUE_CURSOR } from "./library-movies.ts";
import { PERSONAL_MOVIE_DUE_CURSOR } from "./personal-movie-due.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";

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

async function sweepDueToCompletion(h: Awaited<ReturnType<typeof fixture>>) {
  let cursor: string | null = null;
  let pages = 0;
  do {
    const budget = new PublicationAuthorityReadBudget();
    const page = await h.sweep(cursor, budget);
    expect(budget.take).toBeGreaterThan(0);
    cursor = page.nextCursor;
    expect(++pages).toBeLessThan(100);
  } while (cursor !== null);
  return pages;
}

test("default personal choice resumes through the scoped due coordinator after no results", async () => {
  const h = await fixture("default");
  const { f, db } = h;
  try {
    const movie = createMovieNetworkFacetV4(h.context);
    expect(
      await movie.reconcileMovieIntentV4(f.input, testPlexBindingExecution()),
    ).toMatchObject({ reason: "no_acceptable_release" });
    await f.finishMediaOperation({
      operationId: f.input.operationId,
      status: "completed",
      reason: "no_acceptable_release",
    });
    const before = await h.source();
    await sweepDueToCompletion(h);
    await sweepDueToCompletion(h);
    const queued = await h.pending();
    expect(queued).toHaveLength(1);
    const operation = queued[0];
    if (operation === undefined)
      throw new Error("Default due sweep omitted its scoped command");
    expect(operation).toMatchObject({
      kind: "reconcile_movie_edition_v4",
      targetId: f.input.mediaId,
      userId: f.source.user.id,
    });
    const input = MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(operation.payload),
    );
    expect(input.scope).toEqual(f.input.scope);
    expect(
      await db.operation.count({
        where: { idempotencyKey: { startsWith: "due:" } },
      }),
    ).toBe(0);
    expect(await h.source()).toEqual(before);
    h.show();
    expect(
      await movie.reconcileMovieIntentV4(input, testPlexBindingExecution()),
    ).toMatchObject({ status: "acquire" });
    expect(await db.acquisitionAttempt.count()).toBe(1);
  } finally {
    await f.close();
  }
});

test.each(["restricted requester", "existing reservation"])(
  "default chosen demand with %s cannot fall back to generic due work",
  async (guard) => {
    const h = await fixture("default");
    const { f, db } = h;
    try {
      if (guard === "restricted requester") {
        await db.mediaUser.update({
          where: { id: f.source.user.id },
          data: { restricted: true },
        });
      } else {
        h.show();
        expect(
          await createMovieNetworkFacetV4(h.context).reconcileMovieIntentV4(
            f.input,
            testPlexBindingExecution(),
          ),
        ).toMatchObject({ status: "acquire" });
      }
      const before = await h.source();
      await sweepDueToCompletion(h);
      expect(await h.pending()).toEqual([]);
      expect(
        await db.operation.count({
          where: { idempotencyKey: { startsWith: "due:" } },
        }),
      ).toBe(0);
      expect(await h.source()).toEqual(before);
      expect(f.source.wire.additions()).toBe(0);
    } finally {
      await f.close();
    }
  },
);

test("default pre-choice legacy demand retains its existing due route", async () => {
  const h = await fixture("default");
  const { f, db } = h;
  try {
    await db.mediaRequest.updateMany({
      where: { mediaId: f.input.mediaId },
      data: {
        movieEditionChoiceId: null,
        movieEditionChoiceRevision: { increment: 1 },
        version: { increment: 1 },
        active: false,
        direct: false,
        excluded: true,
      },
    });
    const legacy = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Pre-choice legacy requester",
      },
    });
    await db.mediaRequest.create({
      data: { userId: legacy.id, mediaId: f.input.mediaId, edition: "default" },
    });
    await h.sweep(null);
    await h.sweep(`${PERSONAL_MOVIE_DUE_CURSOR}start`);
    expect(await h.pending()).toEqual([]);
    expect(
      await db.operation.findFirstOrThrow({
        where: { idempotencyKey: { startsWith: "due:" } },
      }),
    ).toMatchObject({ kind: "reconcile_media", targetId: f.input.mediaId });
  } finally {
    await f.close();
  }
});

test("default chosen due work cannot replace its original pre-spent shared budget", async () => {
  const h = await fixture("default");
  try {
    const budget = new PublicationAuthorityReadBudget();
    budget.consume(99);
    await h.sweep(null, budget);
    expect(await h.sweep(`${PERSONAL_MOVIE_DUE_CURSOR}start`, budget)).toEqual({
      processed: 1,
      nextCursor: null,
    });
    expect(budget.take).toBeLessThanOrEqual(0);
    expect(await h.pending()).toEqual([]);
    expect(
      await h.db.operation.count({
        where: { idempotencyKey: { startsWith: "due:" } },
      }),
    ).toBe(0);
  } finally {
    await h.f.close();
  }
});

test("eight default movie choices progress within the unchanged shared due-page budget", async () => {
  const h = await fixture("default");
  try {
    for (let index = 1; index < 8; index++) {
      const media = await h.db.mediaItem.create({
        data: {
          kind: "movie",
          title: `Default due fixture ${String(index)}`,
          year: 2020,
          tmdbId: 202_020 + index,
          runtimeMinutes: 1,
          originalLanguage: "en",
        },
      });
      await requestTestMovieV4(h.db, h.f.source.user, media.id, "default");
    }
    await sweepDueToCompletion(h);
    expect(await h.pending()).toHaveLength(8);
    expect(
      await h.db.operation.count({
        where: { idempotencyKey: { startsWith: "due:" } },
      }),
    ).toBe(0);
  } finally {
    await h.f.close();
  }
});

test("fifty default choices cross discovery pages and complete bounded personal pages without starving TV", async () => {
  const h = await fixture("default");
  try {
    for (let index = 1; index < 50; index++) {
      const media = await h.db.mediaItem.create({
        data: {
          kind: "movie",
          title: `Full default due page ${String(index)}`,
          year: 2020,
          tmdbId: 303_030 + index,
          runtimeMinutes: 1,
          originalLanguage: "en",
        },
      });
      await requestTestMovieV4(h.db, h.f.source.user, media.id, "default");
    }
    const tv = await h.db.mediaItem.create({
      data: {
        kind: "series",
        title: "TV following chosen default movies",
        intents: { create: { generation: 1 } },
      },
    });
    await h.db.mediaRequest.create({
      data: { userId: h.f.source.user.id, mediaId: tv.id },
    });
    const pages = await sweepDueToCompletion(h);
    expect(pages).toBe(2 + 1 + 50);
    expect(await h.pending()).toHaveLength(50);
    expect(
      await h.db.operation.findFirstOrThrow({
        where: { idempotencyKey: { startsWith: "due:" }, targetId: tv.id },
      }),
    ).toMatchObject({ kind: "refresh_catalog", targetId: tv.id });
    expect(
      await h.db.operation.count({
        where: {
          idempotencyKey: { startsWith: "due:" },
          kind: "reconcile_media",
        },
      }),
    ).toBe(0);
    // Existing queued commands are charged again, but every cursor invocation
    // keeps its own original 100-record allowance and remains idempotent.
    expect(await sweepDueToCompletion(h)).toBe(pages);
    expect(await h.pending()).toHaveLength(50);
  } finally {
    await h.f.close();
  }
}, 60_000);

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

test.each(["version", "replacement", "after_claim"] as const)(
  "a %s profile change retires an unsubmitted due attempt and admits a fresh same-bucket outbox with new policy evidence",
  async (change) => {
    const h = await fixture("directors_cut");
    const { f, db } = h;
    try {
      await f.finishMediaOperation({
        operationId: f.input.operationId,
        status: "completed",
        reason: "no_acceptable_release",
      });
      h.show();
      const movie = createMovieNetworkFacetV4(h.context);
      await h.sweep(`${PERSONAL_MOVIE_DUE_CURSOR}start`);
      const [originalDue] = await h.pending();
      if (originalDue === undefined) throw new Error("Original due was absent");
      const input = MovieOperationV4Schema.parse(
        z.object(MovieOperationV4Schema.shape).parse(originalDue.payload),
      );
      const first = await movie.reconcileMovieIntentV4(
        input,
        testPlexBindingExecution(),
      );
      expect(first.status).toBe("acquire");
      const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: z.uuid().parse(first.attemptId) },
      });
      const before = await h.source();
      const operation = await db.operation.findUniqueOrThrow({
        where: { id: originalDue.id },
      });
      let expectedProfile = {
        profileId: f.source.profile.id,
        profileVersion: 1,
      };
      const changeProfile = async () => {
        const rules = QualityRulesSchema.parse(f.source.profile.rules);
        if (change === "replacement") {
          const replacement = await db.qualityProfile.create({
            data: {
              name: "Replacement policy",
              rules,
              versions: { create: { version: 0, rules } },
            },
          });
          await db.mediaIntent.update({
            where: {
              mediaId_edition: {
                mediaId: input.mediaId,
                edition: input.scope.edition,
              },
            },
            data: { profileId: replacement.id },
          });
          expectedProfile = { profileId: replacement.id, profileVersion: 0 };
        } else {
          await db.qualityProfileVersion.create({
            data: { profileId: f.source.profile.id, version: 1, rules },
          });
          await db.qualityProfile.update({
            where: { id: f.source.profile.id },
            data: { version: 1, rules },
          });
        }
      };
      if (change === "after_claim") {
        const sections = h.context.permittedSections;
        let reads = 0;
        h.context.permittedSections = async () => {
          if (++reads === 2) {
            expect(
              await db.acquisitionAttempt.findUniqueOrThrow({
                where: { id: attempt.id },
              }),
            ).toMatchObject({ state: "submitting", torrentId: null });
            await changeProfile();
          }
          return sections();
        };
      } else await changeProfile();
      expect(
        await submitMovieTorrentV4(h.context, {
          schemaVersion: 4,
          operationId: input.operationId,
          scope: input.scope,
          attemptId: attempt.id,
        }),
      ).toEqual({ status: "obsolete", reason: "intent_changed" });
      const retired = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      expect(retired).toEqual({
        ...attempt,
        state: "cancelled",
        updatedAt: retired.updatedAt,
      });
      expect(
        await db.acquisitionReservation.count({
          where: { attemptId: attempt.id },
        }),
      ).toBe(0);
      expect(f.source.wire.additions()).toBe(0);
      expect(f.source.wire.control.deletes).toBe(0);
      await h.sweep(`${PERSONAL_MOVIE_DUE_CURSOR}start`);
      await h.sweep(`${PERSONAL_MOVIE_DUE_CURSOR}start`);
      const queued = await h.pending();
      expect(queued).toHaveLength(2);
      const next = queued.find((value) => value.id !== originalDue.id);
      if (next === undefined) throw new Error("Fresh profile due was absent");
      expect(z.string().parse(next.idempotencyKey).split(":").at(-1)).toBe(
        z.string().parse(originalDue.idempotencyKey).split(":").at(-1),
      );
      expect(next.outbox).toMatchObject({
        operationId: next.id,
        payload: next.payload,
      });
      const freshInput = MovieOperationV4Schema.parse(
        z.object(MovieOperationV4Schema.shape).parse(next.payload),
      );
      const fresh = await movie.reconcileMovieIntentV4(
        freshInput,
        testPlexBindingExecution(),
      );
      expect(fresh.status).toBe("acquire");
      const admitted = await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: z.uuid().parse(fresh.attemptId) },
      });
      expect(admitted).toMatchObject({
        state: "reserved",
        operationId: next.id,
        failure: expectedProfile,
      });
      const oldIdentity = MovieAcquisitionIdentityV2Schema.parse(
        attempt.identityEvidence,
      );
      const newIdentity = MovieAcquisitionIdentityV2Schema.parse(
        admitted.identityEvidence,
      );
      expect(newIdentity.assessment).not.toEqual(oldIdentity.assessment);
      expect(
        await db.movieReleaseAssessment.findUniqueOrThrow({
          where: { id: newIdentity.assessment.id },
        }),
      ).toMatchObject(expectedProfile);
      expect(
        await db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        }),
      ).toEqual(retired);
      expect(
        await db.operation.findUniqueOrThrow({ where: { id: originalDue.id } }),
      ).toEqual(operation);
      const after = await h.source();
      expect(after.requests).toEqual(before.requests);
      expect(after.choices).toEqual(before.choices);
      expect(after.original).toEqual(before.original);
      expect(f.source.wire.additions()).toBe(0);
    } finally {
      await f.close();
    }
  },
  60_000,
);

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
