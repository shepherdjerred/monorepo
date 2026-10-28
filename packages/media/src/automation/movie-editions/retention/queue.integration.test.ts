import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { createMovieRetentionFixture } from "#testing/movie-workflow/retention-fixture.ts";
import {
  createOutboxActivities,
  type WorkflowStart,
} from "#automation/store.ts";
import { queueRetentionCheck } from "#automation/watch.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { boundRetentionFixture } from "#automation/retention/lifecycle.test-fixture.ts";
import type { PlexItem } from "#integrations/plex.ts";
import { quarantineMovieFilesV4 } from "./quarantine.ts";
import { publishedWatchQueueFixture } from "./queue.test-fixture.ts";
import { queueMovieRetentionCheck } from "./queue.ts";
import { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import { PrismaPlexEventIngress } from "#infrastructure/plex-events/ingress.ts";
import { ObserveMoviePlexHintV4Schema } from "#shared/plex-events/contract.ts";
import { createMovieWatchFacetV4 } from "#automation/plex-events/movie-activities.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";

let bytes: Uint8Array;
const close: (() => Promise<void>)[] = [];
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const cleanup of close.splice(0)) await cleanup();
});

test.each(MovieEditionKeySchema.options)(
  "actual %s v2 serving binding queues scoped retention and dispatches the new workflow",
  async (edition) => {
    const f = await createMovieRetentionFixture(edition, bytes, false);
    close.push(f.close);
    await queueRetentionCheckForEdition(f, "scoped-route");
    await queueRetentionCheckForEdition(f, "scoped-route");
    const commands = await f.db.operation.findMany({
      where: {
        idempotencyKey: { endsWith: ":scoped-route" },
        targetId: f.scope.mediaId,
      },
    });
    expect(commands).toHaveLength(1);
    const command = commands[0];
    if (command === undefined) throw new Error("Scoped queue omitted command");
    expect(command.kind).toBe("retain_movie_edition_v4");
    expect(command.payload).toMatchObject({
      schemaVersion: 4,
      scope: f.scope,
      generation: f.input.generation,
      recoveryEpoch: 0,
    });
    const starts: WorkflowStart[] = [];
    await createOutboxActivities(f.db, (input) => {
      starts.push(input);
      return Promise.resolve();
    }).dispatchMediaOutbox();
    expect(
      starts.find(
        (start) => start.workflowId === `media-operation-${command.id}`,
      )?.workflowType,
    ).toBe("retainMovieEditionV4Workflow");
  },
);

async function queueRetentionCheckForEdition(
  f: Awaited<ReturnType<typeof createMovieRetentionFixture>>,
  bucket: string,
) {
  const context = movieManagementContext(f.context);
  return f.scope.edition === "default"
    ? queueRetentionCheck(context, f.scope.mediaId, bucket)
    : queueMovieRetentionCheck(context, f.scope, bucket);
}

test("periodic named sweep queues the actual quarantined cut without reconstructing serving ownership", async () => {
  const f = await createMovieRetentionFixture("extended_cut", bytes);
  close.push(f.close);
  await f.warning();
  await f.deliverWarning();
  const result = await f.evaluate();
  if (result.decisionId === null || f.context.now === undefined)
    throw new Error("Missing actual quarantine decision or policy clock");
  const execution = testPublicationExecution();
  await quarantineMovieFilesV4(
    {
      ...f.source.files.context,
      now: f.context.now,
      publicationExecution: () => execution,
      movieManagement: {
        execution,
        budget: new PublicationAuthorityReadBudget(),
      },
    },
    {
      schemaVersion: 4,
      operationId: f.input.operationId,
      decisionId: result.decisionId,
      scope: f.scope,
    },
  );
  expect(
    await createSweepActivities(f.context).sweepMediaWork({
      kind: "watch",
      cursor: "movie-watch:start",
      sweepId: crypto.randomUUID(),
    }),
  ).toEqual({ processed: 1, nextCursor: null });
  const scoped = await f.db.operation.findMany({
    where: {
      targetId: f.scope.mediaId,
      idempotencyKey: { startsWith: "movie-retention-v4:" },
    },
  });
  expect(scoped).toHaveLength(1);
  expect(
    await f.db.operation.count({
      where: { targetId: f.scope.mediaId, kind: "retain_media" },
    }),
  ).toBe(0);
});

describe("one complete named cohort per invocation", () => {
  const h = automationTestHarness();
  test("two real targets paginate; an exhausted supplied allowance protects one and advances without touching the next", async () => {
    const items = new Map<string, PlexItem>();
    const first = await publishedWatchQueueFixture(
      h,
      bytes,
      "directors_cut",
      items,
    );
    const second = await publishedWatchQueueFixture(
      h,
      bytes,
      "extended_cut",
      items,
    );
    close.push(
      () => rm(first.files.directory, { recursive: true, force: true }),
      () => rm(second.files.directory, { recursive: true, force: true }),
    );
    const targets = [first, second].sort((a, b) =>
      a.scope.mediaId.localeCompare(b.scope.mediaId),
    );
    const selected = targets[0];
    const next = targets[1];
    if (selected === undefined || next === undefined)
      throw new Error("Missing two actual targets");
    const budget = new PublicationAuthorityReadBudget();
    budget.consume(99);
    const context = {
      ...first.context,
      movieManagement: { execution: testPlexBindingExecution(), budget },
    };
    const page = await createSweepActivities(context).sweepMediaWork({
      kind: "watch",
      cursor: "movie-watch:start",
      sweepId: crypto.randomUUID(),
    });
    expect(page).toEqual({
      processed: 1,
      nextCursor: `movie-watch:${selected.scope.mediaId}:${selected.scope.edition}`,
    });
    expect(
      await h.database().applicationEvent.findFirst({
        where: {
          mediaId: selected.scope.mediaId,
          kind: "movie_watch_sweep_protected",
        },
      }),
    ).toMatchObject({
      payload: {
        scope: selected.scope,
        reason: "archive_transition_reconciliation_required",
      },
    });
    expect(
      await h.database().watchState.count({
        where: { mediaId: next.scope.mediaId, edition: next.scope.edition },
      }),
    ).toBe(0);
    expect(
      await h.database().operation.count({
        where: { idempotencyKey: { startsWith: "movie-retention-v4:" } },
      }),
    ).toBe(0);
    const fresh = {
      ...first.context,
      movieManagement: {
        execution: testPlexBindingExecution(),
        budget: new PublicationAuthorityReadBudget(),
      },
    };
    expect(
      await createSweepActivities(fresh).sweepMediaWork({
        kind: "watch",
        cursor: page.nextCursor,
        sweepId: crypto.randomUUID(),
      }),
    ).toEqual({ processed: 1, nextCursor: null });
    expect(
      await h.database().operation.findFirst({
        where: {
          targetId: next.scope.mediaId,
          idempotencyKey: { startsWith: "movie-retention-v4:" },
        },
      }),
    ).toMatchObject({
      kind: "retain_movie_edition_v4",
      payload: { scope: next.scope },
    });
  });
});

describe("literal historical default route", () => {
  const h = automationTestHarness();
  test("actual v1 binding retains its old command key and payload", async () => {
    const f = await boundRetentionFixture(h.database(), h.context());
    close.push(() => rm(f.files.directory, { recursive: true, force: true }));
    await queueRetentionCheck(f.context, f.files.media.id, "legacy-route");
    const operation = await h.database().operation.findFirstOrThrow({
      where: {
        targetId: f.files.media.id,
        idempotencyKey: { endsWith: ":legacy-route" },
      },
    });
    expect(operation.kind).toBe("retain_media");
    expect(operation.payload).toEqual({
      operationId: operation.id,
      kind: "retain_media",
      recoveryEpoch: 0,
      mediaId: f.files.media.id,
      generation: f.retention.decision.generation,
    });
  });
});

describe("hint invocation ownership", () => {
  const h = automationTestHarness();
  test.each(["default", "final_cut"] as const)(
    "actual %s v2 hints retain the original budget and SDK before queuing v4 retention",
    async (edition) => {
      const f = await publishedWatchQueueFixture(h, bytes, edition, new Map());
      close.push(() => rm(f.files.directory, { recursive: true, force: true }));
      await new PrismaPlexEventIngress(h.database(), {
        serverMachineId: "fixture-server",
        permittedSections: () => Promise.resolve({ movie: "1", series: "2" }),
      }).accept({
        schemaVersion: 1,
        event: "media.scrobble",
        serverMachineId: "fixture-server",
        sectionId: "1",
        ratingKey: f.item.ratingKey,
        mediaKind: "movie",
      });
      const operation = await h.database().operation.findFirstOrThrow({
        where: {
          targetId: f.scope.mediaId,
          kind: "observe_movie_plex_hint_v4",
        },
      });
      const input = ObserveMoviePlexHintV4Schema.parse(operation.payload);
      const execution = testPlexBindingExecution();
      const budget = new PublicationAuthorityReadBudget();
      budget.consume(100);
      await expect(
        createMovieWatchFacetV4(
          { ...f.context, movieManagement: { execution, budget } },
          () => Promise.resolve(true),
        ).observeMoviePlexHintV4(input, execution),
      ).rejects.toBeInstanceOf(NativeArchiveScopeProtection);
      let expired = false;
      const failure = new Error(
        "Original scoped hint SDK expired during gate loading",
      );
      const sdk = {
        ...execution,
        assertActive() {
          execution.assertActive();
          if (expired) throw failure;
        },
      };
      await expect(
        createMovieWatchFacetV4(f.context, () => {
          expired = true;
          return Promise.resolve(true);
        }).observeMoviePlexHintV4(input, sdk),
      ).rejects.toBe(failure);
      expect(
        await h.database().watchState.count({
          where: { mediaId: f.scope.mediaId, edition: f.scope.edition },
        }),
      ).toBe(0);
      expect(
        await h.database().operation.count({
          where: {
            targetId: f.scope.mediaId,
            idempotencyKey: { startsWith: "movie-retention-v4:" },
          },
        }),
      ).toBe(0);
      expect(
        await createMovieWatchFacetV4(f.context, () =>
          Promise.resolve(true),
        ).observeMoviePlexHintV4(input, testPlexBindingExecution()),
      ).toEqual({ status: "observed", complete: true });
      expect(
        await h.database().operation.findFirst({
          where: {
            targetId: f.scope.mediaId,
            idempotencyKey: { endsWith: `:plex-hint:${input.operationId}` },
          },
        }),
      ).toMatchObject({
        kind: "retain_movie_edition_v4",
        payload: { scope: f.scope },
      });
    },
  );
});
