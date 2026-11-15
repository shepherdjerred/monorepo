import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { createMovieRetentionFixture } from "#testing/movie-workflow/retention-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { queueOperation } from "#automation/store.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { evaluateMovieRetentionV4 } from "./evaluate.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import { reconcileRequestInterests } from "#infrastructure/request-interest/reconcile.ts";
import { nativeInterestFacts } from "#infrastructure/request-interest/facts.ts";

const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
type Fixture = Awaited<ReturnType<typeof createMovieRetentionFixture>>;

async function addRequester(f: Fixture) {
  const user = await f.db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Synthetic warning household member",
    },
  });
  await grantTestRequesterAccess(f.db, user.id, "fixture-server");
  await f.db.credential.create({
    data: {
      userId: user.id,
      kind: "plex",
      ciphertext: f.context.cipher.encrypt(
        JSON.stringify({ serverToken: "synthetic-requester" }),
        `plex:${user.plexAccountId}`,
      ),
    },
  });
  const created = await requestTestMovieV4(
    f.db,
    { ...user, role: "member" },
    f.scope.mediaId,
    f.scope.edition,
  );
  return z.uuid().parse(created.result.requestId);
}

/** Release only this newly added request through actual native watch and reconciliation. */
async function completeNewRequester(f: Fixture, requestId: string) {
  const request = await f.db.mediaRequest.findUniqueOrThrow({
    where: { id: requestId },
  });
  expect(request).toMatchObject({
    interestState: "following",
    interestReleasedAt: null,
  });
  const now = new Date();
  const facts = await f.db.$transaction((tx) =>
    nativeInterestFacts(tx, request, now),
  );
  expect(facts).toMatchObject({
    watchedComplete: true,
    completionComplete: true,
    requestedCoverageComplete: true,
    usableUnwatched: false,
  });
  // A newly observed native progress record can require the producer's progress
  // checkpoint before its separate completion checkpoint, as in the shared fixture.
  const newProgress =
    facts.progressAt !== null &&
    facts.progressAt > (request.lastMeaningfulProgressAt?.getTime() ?? 0);
  const cycles = newProgress ? 2 : 1;
  for (let cycle = 0; cycle < cycles; cycle++) {
    const predecessor = await f.db.mediaRequest.findFirst({
      where: { id: { lt: requestId } },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    expect(
      await reconcileRequestInterests(f.db, {
        cursor: predecessor?.id ?? null,
        now,
      }),
    ).toEqual({ processed: 1, nextCursor: requestId });
    if (newProgress && cycle === 0)
      expect(
        await f.db.mediaRequest.findUniqueOrThrow({ where: { id: requestId } }),
      ).toMatchObject({
        interestState: "following",
        interestRevision: request.interestRevision + 1,
        lastMeaningfulProgressAt: new Date(z.number().parse(facts.progressAt)),
      });
  }
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({ where: { id: requestId } }),
  ).toMatchObject({
    interestState: "finished",
    interestReleaseReason: "watched",
  });
}

async function warning(f: Fixture) {
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: f.scope.mediaId,
        edition: f.scope.edition,
      },
    },
  });
  const operationId = await f.db.$transaction((tx) =>
    queueOperation(tx, {
      key: `synthetic-warning-budget:${crypto.randomUUID()}`,
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
  const input = MovieOperationV4Schema.parse({
    schemaVersion: 4,
    operationId,
    scope: f.scope,
    mediaId: f.scope.mediaId,
    generation: target.generation,
  });
  const result = await evaluateMovieRetentionV4(
    f.context,
    input,
    testPlexBindingExecution(),
  );
  expect(result.status).toBe("warning");
  if (result.decisionId === null)
    throw new Error("Actual retention warning omitted its decision");
  const delivery = await f.db.notificationDelivery.findFirstOrThrow({
    where: {
      userId: f.source.user.id,
      channel: "email",
      event: { mediaId: f.scope.mediaId, kind: "retention_warning" },
    },
  });
  const command = await f.db.operation.findFirstOrThrow({
    where: { kind: "deliver_notification", targetId: delivery.id },
  });
  return { delivery, command, decisionId: result.decisionId };
}

async function originalHistory(f: Fixture, decisionId: string) {
  return {
    decision: await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: decisionId },
    }),
    projection: await f.db.retentionPlexProjection.findUniqueOrThrow({
      where: { decisionId },
    }),
    events: await f.db.applicationEvent.findMany({
      where: { mediaId: f.scope.mediaId, kind: "retention_warning" },
      orderBy: { id: "asc" },
    }),
    publication: await f.db.operation.findUniqueOrThrow({
      where: { id: f.publicationOperationId },
    }),
  };
}

test("an explicit authority-budget failure before the warning attempt rolls back the claim without a provider outcome", async () => {
  const f = await createMovieRetentionFixture("directors_cut", bytes, false);
  closers.push(f.close);
  const { delivery, command, decisionId } = await warning(f);
  const history = await originalHistory(f, decisionId);
  // Inject the exact protection at the pre-attempt boundary; all request,
  // publication, watch and warning authority came from their real producers.
  const db = queryFixtureDatabase(f.db, {
    query: {
      notificationDeliveryAttempt: {
        create() {
          throw new NativeArchiveScopeProtection(
            "Synthetic pre-attempt authority admission failure",
          );
        },
      },
    },
  });
  expect(
    await createNotificationActivities({
      ...f.context,
      db,
    }).deliverMediaNotification({
      operationId: command.id,
      notificationId: delivery.id,
    }),
  ).toEqual({
    status: "failed",
    reason: "archive_transition_reconciliation_required",
  });
  expect(f.sent).toHaveLength(0);
  expect(
    await f.db.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    }),
  ).toEqual(delivery);
  expect(
    await f.db.notificationDeliveryAttempt.count({
      where: { deliveryId: delivery.id },
    }),
  ).toBe(0);
  expect(await originalHistory(f, decisionId)).toEqual(history);
}, 60_000);

test("the original warning allowance accounts cumulatively for both real household compositions and the accepted send", async () => {
  const f = await createMovieRetentionFixture("extended_cut", bytes, false);
  closers.push(f.close);
  const requestIds: string[] = [];
  for (let index = 0; index < 4; index++)
    requestIds.push(await addRequester(f));
  expect(
    await observeRequesterWatch(f.context, f.scope.mediaId, {
      edition: f.scope.edition,
    }),
  ).toEqual({ complete: true, reason: null });
  for (const requestId of requestIds) await completeNewRequester(f, requestId);
  const { delivery, command, decisionId } = await warning(f);
  const history = await originalHistory(f, decisionId);
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  expect(budget.take).toBe(101);
  // Five genuine recipients cost 2 preparation + 18 per composition = 38,
  // within the unchanged 100-record allowance, rather than exhausting it.
  let claimed = false;
  let receipt: string | undefined;
  expect(
    await createNotificationActivities({
      ...f.context,
      plexBindingExecution: () => execution,
      movieManagement: { execution, budget },
      checkpoint: () => {
        expect(budget.take).toBe(81);
        claimed = true;
        return Promise.resolve();
      },
      notify: async (message, options) => {
        expect(claimed).toBe(true);
        expect(budget.take).toBe(63);
        const outcome = await f.context.notify(message, options);
        receipt = outcome.receipt;
        return outcome;
      },
    }).deliverMediaNotification({
      operationId: command.id,
      notificationId: delivery.id,
    }),
  ).toEqual({ status: "accepted", reason: null });
  expect(claimed).toBe(true);
  expect(budget.take).toBe(63);
  expect(f.sent).toHaveLength(1);
  const actualReceipt = z.string().min(1).parse(receipt);
  const accepted = await f.db.notificationDelivery.findUniqueOrThrow({
    where: { id: delivery.id },
  });
  expect(accepted).toMatchObject({
    state: "accepted",
    attempts: 1,
    failureReason: null,
    providerReceipt: actualReceipt,
    acceptedAt: expect.any(Date),
  });
  const attempts = await f.db.notificationDeliveryAttempt.findMany({
    where: { deliveryId: delivery.id },
  });
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({
    state: "accepted",
    rejectionReason: null,
    providerReceipt: actualReceipt,
  });
  const attempt = attempts[0];
  if (attempt?.finishedAt == null)
    throw new Error("Accepted warning attempt omitted its finish time");
  expect(attempt.finishedAt.getTime()).toBeGreaterThanOrEqual(
    attempt.startedAt.getTime(),
  );
  expect(await originalHistory(f, decisionId)).toEqual(history);
}, 60_000);
