import { afterEach, beforeAll, expect, test } from "vitest";
import {
  createMovieRemovalNoticeFixture,
  removalDeliveryInvocation,
  deliverRemovalNotice,
  type MovieRemovalNoticeFixture,
} from "#testing/movie-workflow/removal-notice-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import {
  MovieEditionKeySchema,
  movieEditionDisplayLabel,
} from "#shared/movie-editions/registry.ts";
import {
  MovieRemovalNoticeV4Schema,
  type MovieRemovalCompletionV4,
} from "#shared/movie-editions/removal-v4.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { completeMovieRemovalV4 } from "./removal-completion.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { createRestoredMovieFixture } from "#testing/movie-workflow/restore-fixture.ts";
import { publishRestoredMovieToPlexV4 } from "./restore-plex.ts";
import { finalizeMovieRestorationV4 } from "./restore-finalization.ts";
import { MovieRestorationNoticeV4Schema } from "#shared/movie-editions/notifications-v4.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";

const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function ready() {
  const f = await createMovieRemovalNoticeFixture("directors_cut", bytes);
  closers.push(f.close);
  return f;
}

async function notice(
  f: MovieRemovalNoticeFixture,
  stage: MovieRemovalCompletionV4["stage"],
) {
  return f.db.notificationDelivery.findFirstOrThrow({
    where: {
      userId: f.source.user.id,
      channel: "email",
      event: {
        mediaId: f.scope.mediaId,
        payload: { path: ["source", "stage"], equals: stage },
        kind: stage === "quarantined" ? "files_quarantined" : "files_purged",
      },
    },
    include: { event: true },
  });
}

async function physicalHistory(f: MovieRemovalNoticeFixture) {
  return {
    asset: await f.db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
      include: { subtitles: { orderBy: { id: "asc" } }, coverage: true },
    }),
    decision: await f.db.retentionDecision.findUniqueOrThrow({
      where: { id: f.completion.decisionId },
    }),
    commands: await f.db.operation.findMany({
      where: {
        id: { in: [f.completion.operationId, f.publicationOperationId] },
      },
      orderBy: { id: "asc" },
    }),
    pointer: await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      },
    }),
  };
}

async function cancel(f: MovieRemovalNoticeFixture) {
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.scope.mediaId, edition: f.scope.edition },
    },
  });
  const request = await f.db.mediaRequest.findUniqueOrThrow({
    where: {
      userId_mediaId_edition: {
        userId: f.source.user.id,
        mediaId: f.scope.mediaId,
        edition: f.scope.edition,
      },
    },
  });
  const commands = new MovieLifecycleCommands(f.db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
    movieSectionId: "1",
  });
  await commands.cancelMovieEditionRequest(f.source.user, crypto.randomUUID(), {
    schemaVersion: 3,
    action: "cancel_request",
    scope: f.scope,
    subjectUserId: f.source.user.id,
    requestId: request.id,
    expected: {
      targetVersion: target.version,
      requestVersion: request.version,
      choiceRevision: request.movieEditionChoiceRevision,
    },
  });
}

test.each(MovieEditionKeySchema.options)(
  "%s sends actual quarantine and purge emails and acknowledges their literal source after a new request",
  async (edition) => {
    const f = await createMovieRemovalNoticeFixture(edition, bytes);
    closers.push(f.close);
    const initialSent = f.sent.length;
    const completed: Awaited<ReturnType<typeof notice>>[] = [];
    for (const stage of ["quarantined", "purged"] as const) {
      const completion =
        stage === "quarantined" ? f.completion : await f.purge();
      const before = await physicalHistory(f);
      expect(
        await completeMovieRemovalV4(
          f.context,
          completion,
          testPlexBindingExecution(),
        ),
      ).toEqual({ status: "completed", reason: null });
      const delivery = await notice(f, completion.stage);
      const payload = MovieRemovalNoticeV4Schema.parse(delivery.event.payload);
      expect(payload).toMatchObject({
        source: completion,
        asset: {
          id: f.asset.id,
          version: f.asset.version + (stage === "quarantined" ? 1 : 2),
        },
        recoveryEpoch: before.asset.ownershipEpoch,
      });
      const call = removalDeliveryInvocation(f);
      expect(await deliverRemovalNotice(f, call.context, delivery.id)).toEqual({
        status: "accepted",
        reason: null,
      });
      expect(() => call.budget.consume(0)).not.toThrow();
      expect(f.sent.at(-1)?.text).toContain(movieEditionDisplayLabel(edition));
      expect(f.sent.at(-1)?.text).toContain(
        stage === "quarantined" ? "moved to quarantine" : "permanently removed",
      );
      expect(await physicalHistory(f)).toEqual(before);
      expect(
        await completeMovieRemovalV4(
          f.context,
          completion,
          testPlexBindingExecution(),
        ),
      ).toEqual({ status: "completed", reason: null });
      completed.push(delivery);
    }
    expect(f.sent).toHaveLength(initialSent + 2);
    await requestTestMovieV4(f.db, f.source.user, f.scope.mediaId, edition);
    for (const delivery of completed) {
      const call = removalDeliveryInvocation(f);
      call.context.permittedSections = () =>
        Promise.reject(
          new Error("Historical ACK must not consult current configuration"),
        );
      expect(await deliverRemovalNotice(f, call.context, delivery.id)).toEqual({
        status: "accepted",
        reason: null,
      });
    }
    expect(f.sent).toHaveLength(initialSent + 2);
  },
  60_000,
);

test.each(["cancel", "configuration", "generation", "preference"] as const)(
  "%s after the real removal delivery claim suppresses the send",
  async (change) => {
    const f = await ready();
    expect(
      await completeMovieRemovalV4(
        f.context,
        f.completion,
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "completed" });
    const delivery = await notice(f, "quarantined");
    const before = f.sent.length;
    const call = removalDeliveryInvocation(f);
    call.context.checkpoint = async () => {
      if (change === "cancel") await cancel(f);
      if (change === "configuration")
        call.context.permittedSections = () =>
          Promise.resolve({ movie: "2", series: "2" });
      if (change === "generation")
        await requestTestMovieV4(
          f.db,
          f.source.user,
          f.scope.mediaId,
          f.scope.edition,
        );
      if (change === "preference")
        await f.db.notificationPreference.update({
          where: { userId: f.source.user.id },
          data: { removalCompleted: false },
        });
    };
    expect(
      await deliverRemovalNotice(f, call.context, delivery.id),
    ).toMatchObject({ status: "failed" });
    expect(f.sent).toHaveLength(before);
    expect(
      await f.db.notificationDeliveryAttempt.findFirstOrThrow({
        where: { deliveryId: delivery.id },
      }),
    ).toMatchObject({ state: "rejected" });
  },
  60_000,
);

test("the personal removal preference prevents fanout and a later real request makes an unqueued completion obsolete", async () => {
  const f = await ready();
  await f.db.notificationPreference.update({
    where: { userId: f.source.user.id },
    data: { removalCompleted: false },
  });
  expect(
    await completeMovieRemovalV4(
      f.context,
      f.completion,
      testPlexBindingExecution(),
    ),
  ).toMatchObject({ status: "completed" });
  expect(
    await f.db.notificationDelivery.count({
      where: {
        event: {
          mediaId: f.scope.mediaId,
          payload: { path: ["kind"], equals: "movie_removal" },
        },
      },
    }),
  ).toBe(0);
  const purged = await f.purge();
  await requestTestMovieV4(
    f.db,
    f.source.user,
    f.scope.mediaId,
    f.scope.edition,
  );
  expect(
    await completeMovieRemovalV4(f.context, purged, testPlexBindingExecution()),
  ).toEqual({ status: "obsolete", reason: "scope_changed" });
}, 60_000);

test("one original exhausted allowance protects removal delivery before a provider attempt", async () => {
  const f = await ready();
  expect(
    await completeMovieRemovalV4(
      f.context,
      f.completion,
      testPlexBindingExecution(),
    ),
  ).toMatchObject({ status: "completed" });
  const delivery = await notice(f, "quarantined");
  const before = f.sent.length;
  const call = removalDeliveryInvocation(f);
  call.budget.consume(99);
  expect(
    await deliverRemovalNotice(f, call.context, delivery.id),
  ).toMatchObject({ status: "failed" });
  expect(() => call.budget.consume(0)).toThrow("100 total queried records");
  expect(f.sent).toHaveLength(before);
  expect(
    await f.db.notificationDeliveryAttempt.count({
      where: { deliveryId: delivery.id },
    }),
  ).toBe(0);
}, 60_000);

test("an unknown provider result never authorizes a removal resend", async () => {
  const f = await ready();
  expect(
    await completeMovieRemovalV4(
      f.context,
      f.completion,
      testPlexBindingExecution(),
    ),
  ).toMatchObject({ status: "completed" });
  const delivery = await notice(f, "quarantined");
  const before = f.sent.length;
  const call = removalDeliveryInvocation(f);
  call.context.notify = async (message, mutation) => {
    await f.context.notify(message, mutation);
    throw new Error("Synthetic lost provider reply");
  };
  expect(
    await deliverRemovalNotice(f, call.context, delivery.id),
  ).toMatchObject({ status: "unknown" });
  expect(
    await deliverRemovalNotice(
      f,
      removalDeliveryInvocation(f).context,
      delivery.id,
    ),
  ).toMatchObject({ status: "unknown" });
  expect(f.sent).toHaveLength(before + 1);
}, 60_000);

test("actual removal and restoration notices pin immutable source and recipient selections in SQL", async () => {
  const removal = await ready();
  await completeMovieRemovalV4(
    removal.context,
    removal.completion,
    testPlexBindingExecution(),
  );
  const removed = await notice(removal, "quarantined");
  const restored = await createRestoredMovieFixture("extended_cut", bytes);
  closers.push(restored.close);
  expect(
    await publishRestoredMovieToPlexV4(
      restored.context,
      restored.input,
      testPlexBindingExecution(),
    ),
  ).toMatchObject({ status: "available" });
  await finalizeMovieRestorationV4(
    restored.context,
    restored.input,
    testPlexBindingExecution(),
  );
  const restoredDelivery =
    await restored.db.notificationDelivery.findFirstOrThrow({
      where: {
        event: {
          mediaId: restored.scope.mediaId,
          payload: { path: ["kind"], equals: "movie_restoration" },
        },
      },
      include: { event: true },
    });
  for (const selected of [
    {
      db: removal.db,
      delivery: removed,
      payload: MovieRemovalNoticeV4Schema.parse(removed.event.payload),
    },
    {
      db: restored.db,
      delivery: restoredDelivery,
      payload: MovieRestorationNoticeV4Schema.parse(
        restoredDelivery.event.payload,
      ),
    },
  ]) {
    await expect(
      selected.db.applicationEvent.update({
        where: { id: selected.delivery.eventId },
        data: { payload: {} },
      }),
    ).rejects.toThrow("immutable");
    await expect(
      selected.db.applicationEvent.delete({
        where: { id: selected.delivery.eventId },
      }),
    ).rejects.toThrow("immutable");
    await expect(
      selected.db.notificationDelivery.update({
        where: { id: selected.delivery.id },
        data: { channel: "discord_shared" },
      }),
    ).rejects.toThrow("immutable");
    await expect(
      selected.db.notificationDelivery.delete({
        where: { id: selected.delivery.id },
      }),
    ).rejects.toThrow("immutable");
    const call = removalDeliveryInvocation({
      context: selected.db === removal.db ? removal.context : restored.context,
    });
    await expect(
      selected.db.$transaction(async (tx) => {
        await bindPlexTransactionDeadline(
          tx,
          plexBindingFreshness({ ...call.execution, guards: [call.execution] }),
        );
        await tx.applicationEvent.create({
          data: {
            dedupeKey: `synthetic-invalid-post-effect:${crypto.randomUUID()}`,
            mediaId: selected.delivery.event.mediaId,
            actorId: selected.delivery.event.actorId,
            kind: selected.delivery.event.kind,
            payload: {
              ...selected.payload,
              asset: {
                ...selected.payload.asset,
                version: selected.payload.asset.version + 1,
              },
            },
          },
        });
      }),
    ).rejects.toThrow();
  }
}, 60_000);
