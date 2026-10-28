import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { MovieInterventionNoticeV4Schema } from "#shared/movie-editions/intervention/v4.ts";
import {
  MovieEditionKeySchema,
  movieEditionDisplayLabel,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import type { MediaAutomationContext } from "#automation/context.ts";

const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function fixture(
  edition: MovieEditionKey = "extended_cut",
  ownerEmailEnabled = true,
  reason: string | null = "movie_operation_failed",
  restrictedRequester = false,
) {
  const f = await createMovieWorkflowFixture(edition, { bytes });
  closers.push(f.close);
  const db = f.source.db;
  const owner = await db.mediaUser.findFirstOrThrow({
    where: { role: "owner" },
  });
  await grantTestRequesterAccess(db, owner.id, "fixture-server");
  for (const user of [f.source.user, owner]) {
    await db.mediaUser.update({
      where: { id: user.id },
      data: {
        email: `${user.id}@intervention.fixture`,
        emailVerifiedAt: new Date(),
      },
    });
    await db.notificationPreference.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        emailEnabled: user.id !== owner.id || ownerEmailEnabled,
      },
      update: { emailEnabled: user.id !== owner.id || ownerEmailEnabled },
    });
  }
  const page = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === `/media/${f.input.mediaId}`
        ? new Response("Synthetic Media detail route", { status: 200 })
        : new Response(null, { status: 404 }),
  });
  closers.unshift(() => page.stop(true));
  const sent: Parameters<MediaAutomationContext["notify"]>[0][] = [];
  const receipts = new Map<string, string>();
  const context: MediaAutomationContext = {
    ...f.source.context,
    publicOrigin: page.url.origin,
    notify: (message, mutation) => {
      mutation?.beforeMutation();
      sent.push(message);
      const receipt = `synthetic-movie-intervention:${message.idempotencyKey}`;
      receipts.set(receipt, message.recipient);
      return Promise.resolve({ receipt });
    },
    reconcileNotification: (input) =>
      Promise.resolve({
        status: receipts.has(input.receipt) ? "delivered" : "unknown",
        recipient: receipts.get(input.receipt) ?? null,
      }),
  };
  const reconciled = await f.movie.reconcileMovieIntentV4(
    f.input,
    testPlexBindingExecution(),
  );
  expect(reconciled.status).toBe("acquire");
  if (reconciled.attemptId === null)
    throw new Error("Actual failed movie coordinator omitted its acquisition");
  const input = {
    schemaVersion: 4 as const,
    operationId: f.input.operationId,
    attemptId: reconciled.attemptId,
    scope: f.input.scope,
  };
  expect(
    await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "submitted", reason: null });
  const birth = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  if (restrictedRequester)
    await db.mediaUser.update({
      where: { id: f.source.user.id },
      data: { restricted: true },
    });
  for (let repeat = 0; repeat < 2; repeat++)
    await f.finishMediaOperation({
      operationId: f.input.operationId,
      status: "reconciling",
      reason,
    });
  return { ...f, db, context, owner, birth, sent };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function deliveries(f: Fixture) {
  return f.db.notificationDelivery.findMany({
    where: {
      event: {
        mediaId: f.input.mediaId,
        kind: { in: ["acquisition_failed", "system_intervention"] },
      },
    },
    include: { event: true },
    orderBy: { userId: "asc" },
  });
}

async function inputFor(f: Fixture, notificationId: string) {
  const command = await f.db.operation.findFirstOrThrow({
    where: { kind: "deliver_notification", targetId: notificationId },
  });
  return { operationId: command.id, notificationId };
}

async function history(f: Fixture) {
  const source = await f.db.operation.findUniqueOrThrow({
    where: { id: f.input.operationId },
  });
  return {
    source: {
      id: source.id,
      kind: source.kind,
      payload: source.payload,
      userId: source.userId,
      targetId: source.targetId,
    },
    birth: await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    }),
    choices: await f.db.movieEditionChoice.findMany({
      where: { rootMediaId: f.input.mediaId },
      orderBy: { id: "asc" },
    }),
    notices: await f.db.applicationEvent.findMany({
      where: {
        mediaId: f.input.mediaId,
        kind: { in: ["acquisition_failed", "system_intervention"] },
      },
      orderBy: { id: "asc" },
    }),
  };
}

async function cancel(f: Fixture) {
  const request = await f.db.mediaRequest.findFirstOrThrow({
    where: {
      mediaId: f.input.mediaId,
      userId: f.source.user.id,
      edition: f.input.scope.edition,
    },
  });
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: f.input.mediaId,
        edition: f.input.scope.edition,
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
    scope: f.input.scope,
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
  "%s real failure settlement delivers one exact-cut requester notice and one opted-in owner notice without a publication receipt",
  async (edition) => {
    const f = await fixture(edition);
    const before = await history(f);
    const selected = await deliveries(f);
    expect(selected).toHaveLength(2);
    expect(selected.map((delivery) => delivery.userId).sort()).toEqual(
      [f.source.user.id, f.owner.id].sort(),
    );
    expect(f.birth.filePlan).toBeNull();
    expect(await f.db.libraryAsset.count()).toBe(0);
    const source = await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    });
    expect(source.status).toBe("reconciling");
    for (const delivery of selected) {
      const owner = delivery.userId === f.owner.id;
      const payload = MovieInterventionNoticeV4Schema.parse(
        delivery.event.payload,
      );
      if (!owner)
        expect(payload.recipient).toMatchObject({
          requestId: f.birth.sponsorRequestId,
          choiceId: f.birth.movieEditionChoiceId,
          choiceRevision: f.birth.movieEditionChoiceRevision,
        });
      expect(delivery.event).toMatchObject({
        kind: owner ? "system_intervention" : "acquisition_failed",
        mediaId: f.input.mediaId,
        payload: {
          schemaVersion: 4,
          kind: "movie_intervention",
          eventKind: owner ? "system_intervention" : "acquisition_failed",
          source: f.input,
          sourceHash: identityHash(source.payload),
          recoveryEpoch: f.birth.recoveryEpoch,
          failure: { status: "reconciling", reason: "movie_operation_failed" },
          recipient: {
            kind: owner ? "owner" : "personal",
            userId: delivery.userId,
          },
          attemptId: f.birth.id,
        },
      });
      expect(
        await createNotificationActivities(f.context).deliverMediaNotification(
          await inputFor(f, delivery.id),
        ),
      ).toEqual({ status: "accepted", reason: null });
    }
    expect(f.sent).toHaveLength(2);
    for (const message of f.sent) {
      expect(message.subject).toContain(movieEditionDisplayLabel(edition));
      expect(message.text).toContain(movieEditionDisplayLabel(edition));
      const links = message.text.match(/https?:\/\/\S+/gu);
      expect(links).toHaveLength(1);
      for (const link of links ?? []) {
        const response = await fetch(link);
        expect(response.status).toBe(200);
      }
    }
    await f.db.plexIdentityMapping.update({
      where: { userId: f.source.user.id },
      data: { permittedSectionIds: [] },
    });
    for (const delivery of selected) {
      expect(
        await createNotificationActivities({
          ...f.context,
          permittedSections: () =>
            Promise.reject(
              new Error("Historical failure ACK must precede configuration"),
            ),
        }).deliverMediaNotification(await inputFor(f, delivery.id)),
      ).toEqual({ status: "accepted", reason: null });
      expect(
        await f.db.notificationDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        }),
      ).toMatchObject({
        state: "accepted",
        attempts: 1,
        providerStatus: "delivered",
      });
    }
    expect(f.sent).toHaveLength(2);
    expect(await history(f)).toEqual(before);
    expect(
      await f.db.movieEditionChoice.count({
        where: { subjectUserId: f.owner.id },
      }),
    ).toBe(0);
  },
  60_000,
);

test.each([
  "cancel",
  "access",
  "section",
  "owner_preferences",
  "owner_restricted",
] as const)(
  "%s after the actual failure-notice claim prevents an unauthorized send",
  async (change) => {
    const f = await fixture();
    const owner = change.startsWith("owner_");
    const notices = await deliveries(f);
    const selected = notices.find(
      (delivery) => delivery.userId === (owner ? f.owner.id : f.source.user.id),
    );
    if (selected === undefined)
      throw new Error("Actual failure settlement omitted its scoped recipient");
    let claimed = false;
    const result = await createNotificationActivities({
      ...f.context,
      permittedSections: () =>
        claimed && change === "section"
          ? Promise.resolve({ movie: "", series: "2" })
          : f.context.permittedSections(),
      checkpoint: async () => {
        claimed = true;
        if (change === "cancel") await cancel(f);
        if (change === "access")
          await f.db.plexIdentityMapping.update({
            where: { userId: f.source.user.id },
            data: { permittedSectionIds: [] },
          });
        if (change === "owner_preferences")
          await f.db.notificationPreference.update({
            where: { userId: f.owner.id },
            data: { emailEnabled: false, version: { increment: 1 } },
          });
        if (change === "owner_restricted")
          await f.db.mediaUser.update({
            where: { id: f.owner.id },
            data: { restricted: true },
          });
      },
    }).deliverMediaNotification(await inputFor(f, selected.id));
    expect(claimed).toBe(true);
    expect(result).toEqual({
      status: "failed",
      reason: "authority_changed_before_send",
    });
    expect(f.sent).toEqual([]);
    expect(
      await f.db.notificationDelivery.findUniqueOrThrow({
        where: { id: selected.id },
      }),
    ).toMatchObject({ state: "failed", attempts: 1, providerReceipt: null });
    const attempts = await f.db.notificationDeliveryAttempt.findMany({
      where: { deliveryId: selected.id },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      state: "rejected",
      rejectionReason: "authority_changed_before_send",
      providerReceipt: null,
    });
  },
  60_000,
);

test("an owner without enabled delivery preferences gains no failure delivery or personal choice", async () => {
  const f = await fixture("theatrical_cut", false);
  const notices = await deliveries(f);
  expect(notices.map((delivery) => delivery.userId)).toEqual([
    f.source.user.id,
  ]);
  expect(
    await f.db.movieEditionChoice.count({
      where: { subjectUserId: f.owner.id },
    }),
  ).toBe(0);
}, 60_000);

test("actual scoped failure settlement accepts a null reason without requiring a publication receipt", async () => {
  const f = await fixture("uncut_version", true, null);
  expect(
    await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    }),
  ).toMatchObject({ status: "reconciling", result: { reason: null } });
  const selected = await deliveries(f);
  expect(selected).toHaveLength(2);
  for (const delivery of selected)
    expect(
      MovieInterventionNoticeV4Schema.parse(delivery.event.payload).failure,
    ).toEqual({ status: "reconciling", reason: null });
  expect(f.birth.filePlan).toBeNull();
  expect(await f.db.libraryAsset.count()).toBe(0);
}, 60_000);

test("real requester restriction before failure settlement preserves owner attention without creating a forbidden personal notice", async () => {
  const f = await fixture(
    "directors_cut",
    true,
    "movie_operation_failed",
    true,
  );
  expect(
    await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    }),
  ).toMatchObject({ status: "reconciling" });
  const notices = await deliveries(f);
  expect(notices.map((delivery) => delivery.userId)).toEqual([f.owner.id]);
  expect(notices[0]).toMatchObject({ event: { kind: "system_intervention" } });
  expect(
    await f.db.movieEditionChoice.count({
      where: { rootMediaId: f.input.mediaId },
    }),
  ).toBe(1);
}, 60_000);

test("SQL retains the actual failure notice selection and its exact recipient", async () => {
  const f = await fixture();
  const notices = await deliveries(f);
  const personal = notices.find(
    (delivery) => delivery.userId === f.source.user.id,
  );
  if (personal === undefined)
    throw new Error("Actual failure event missing before immutability checks");
  await expect(
    f.db
      .$executeRaw`UPDATE "ApplicationEvent" SET payload=jsonb_set(payload,'{recipient,userId}',to_jsonb(${f.owner.id}::text)) WHERE id=${personal.event.id}`,
  ).rejects.toThrow("Movie intervention source is immutable");
  await expect(
    f.db
      .$executeRaw`DELETE FROM "ApplicationEvent" WHERE id=${personal.event.id}`,
  ).rejects.toThrow("Movie intervention source is immutable");
  await expect(
    f.db
      .$executeRaw`UPDATE "NotificationDelivery" SET "userId"=${f.owner.id} WHERE id=${personal.id}`,
  ).rejects.toThrow("Movie intervention recipient and source are immutable");
  expect(await deliveries(f)).toEqual(notices);
}, 60_000);

test("a genuine unchanged-generation retry renewal protects both old pending failure notices without another send", async () => {
  const f = await fixture();
  const pending = await deliveries(f);
  expect(pending).toHaveLength(2);
  const media = await f.db.mediaItem.findUniqueOrThrow({
    where: { id: f.input.mediaId },
  });
  const target = await f.db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: f.input.mediaId,
        edition: f.input.scope.edition,
      },
    },
  });
  const commands = new MovieLifecycleCommands(f.db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
    movieSectionId: "1",
  });
  const queued = await commands.retryMovieEditionV4(
    f.source.user,
    crypto.randomUUID(),
    {
      schemaVersion: 4,
      scope: f.input.scope,
      expected: { mediaVersion: media.version, targetVersion: target.version },
      command: { action: "retry" },
    },
  );
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: z.uuid().parse(queued.result.operationId) },
  });
  const input = MovieOperationV4Schema.parse(
    z.object(MovieOperationV4Schema.shape).parse(operation.payload),
  );
  expect(input.generation).toBe(f.input.generation);
  // Only Temporal's external description port is synthetic in this Media boundary test.
  const movie = createMovieNetworkFacetV4({
    ...f.context,
    describeWorkflow: (id) => {
      if (
        id !== `media-operation-${f.input.operationId}` &&
        id !== `media-acquire-${f.birth.id}`
      )
        throw new Error(
          "Retry must inspect its actual exact original coordinator and child",
        );
      return Promise.resolve({
        status: "FAILED",
        runId: `synthetic-closed:${id}`,
      });
    },
  });
  expect(
    await movie.reconcileMovieIntentV4(input, testPlexBindingExecution()),
  ).toMatchObject({ status: "acquire", attemptId: f.birth.id });
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    }),
  ).toMatchObject({
    operationId: f.birth.operationId,
    coordinatorOperationId: input.operationId,
    identityEvidence: f.birth.identityEvidence,
    movieEditionAuthority: f.birth.movieEditionAuthority,
  });
  const before = await history(f);
  for (const delivery of pending) {
    expect(
      await createNotificationActivities(f.context).deliverMediaNotification(
        await inputFor(f, delivery.id),
      ),
    ).toMatchObject({ status: "failed" });
    expect(
      await f.db.notificationDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      }),
    ).toMatchObject({ state: "pending", attempts: 0, providerReceipt: null });
    expect(
      await f.db.notificationDeliveryAttempt.count({
        where: { deliveryId: delivery.id },
      }),
    ).toBe(0);
  }
  expect(f.sent).toEqual([]);
  expect(await history(f)).toEqual(before);
  expect(f.source.wire.additions()).toBe(1);
}, 60_000);

test("an unknown failure-notice provider outcome remains unknown and cannot authorize a second send", async () => {
  const f = await fixture();
  const notices = await deliveries(f);
  const selected = notices.find(
    (delivery) => delivery.userId === f.source.user.id,
  );
  if (selected === undefined)
    throw new Error("Actual requester failure notice missing");
  let sends = 0;
  const notify: MediaAutomationContext["notify"] = (_message, mutation) => {
    mutation?.beforeMutation();
    sends++;
    return Promise.reject(
      new Error("Synthetic provider lost its accepted reply"),
    );
  };
  const context = { ...f.context, notify };
  const input = await inputFor(f, selected.id);
  expect(
    await createNotificationActivities(context).deliverMediaNotification(input),
  ).toMatchObject({ status: "unknown" });
  expect(
    await createNotificationActivities(context).deliverMediaNotification(input),
  ).toMatchObject({ status: "unknown" });
  expect(sends).toBe(1);
  expect(
    await f.db.notificationDelivery.findUniqueOrThrow({
      where: { id: selected.id },
    }),
  ).toMatchObject({ state: "unknown", attempts: 1, providerReceipt: null });
}, 60_000);
