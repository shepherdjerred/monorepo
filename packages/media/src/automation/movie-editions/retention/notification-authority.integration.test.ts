import { afterEach, beforeAll, expect, test } from "vitest";
import { createMovieRetentionFixture } from "#testing/movie-workflow/retention-fixture.ts";
import { createRestoredMovieFixture } from "#testing/movie-workflow/restore-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { publishRestoredMovieToPlexV4 } from "./restore-plex.ts";
import { finalizeMovieRestorationV4 } from "./restore-finalization.ts";

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
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  return {
    execution,
    budget,
    context: {
      ...f.context,
      plexBindingExecution: () => execution,
      movieManagement: { execution, budget },
    },
  };
}

async function restoration() {
  const f = await createRestoredMovieFixture("extended_cut", bytes);
  closers.push(f.close);
  const rebind = invocation(f);
  expect(
    await publishRestoredMovieToPlexV4(
      rebind.context,
      f.input,
      rebind.execution,
    ),
  ).toEqual({ status: "available", reason: null });
  const completion = invocation(f);
  await finalizeMovieRestorationV4(
    completion.context,
    f.input,
    completion.execution,
  );
  return f;
}

async function selectedDelivery(f: Fixture, kind: "warning" | "restoration") {
  const delivery = await f.db.notificationDelivery.findFirstOrThrow({
    where: {
      userId: f.source.user.id,
      channel: "email",
      event: {
        mediaId: f.scope.mediaId,
        ...(kind === "warning"
          ? { kind: "retention_warning" as const }
          : {
              kind: "media_available" as const,
              payload: { path: ["kind"], equals: "movie_restoration" },
            }),
      },
    },
  });
  const command = await f.db.operation.findFirstOrThrow({
    where: { kind: "deliver_notification", targetId: delivery.id },
  });
  return {
    delivery,
    input: { operationId: command.id, notificationId: delivery.id },
  };
}

async function sourceHistory(f: Fixture) {
  return {
    parents: await f.db.operation.findMany({
      where: {
        targetId: f.scope.mediaId,
        kind: { not: "deliver_notification" },
      },
      orderBy: { id: "asc" },
    }),
    assets: await f.db.libraryAsset.findMany({
      where: { editionRootId: f.scope.rootMediaId },
      include: {
        subtitles: { orderBy: { id: "asc" } },
        coverage: { orderBy: { mediaId: "asc" } },
      },
      orderBy: { id: "asc" },
    }),
    decisions: await f.db.retentionDecision.findMany({
      where: { mediaId: f.scope.mediaId },
      orderBy: { id: "asc" },
    }),
    projections: await f.db.retentionPlexProjection.findMany({
      where: { decision: { mediaId: f.scope.mediaId } },
      orderBy: { decisionId: "asc" },
    }),
    associations: await f.db.plexAssociationEvidence.findMany({
      where: { mediaId: f.scope.mediaId },
      orderBy: { id: "asc" },
    }),
    pointers: await f.db.plexBindingCurrent.findMany({
      where: { mediaId: f.scope.mediaId },
      orderBy: { edition: "asc" },
    }),
    events: await f.db.applicationEvent.findMany({
      where: { mediaId: f.scope.mediaId },
      orderBy: { id: "asc" },
    }),
  };
}

test.each(["warning", "restoration"] as const)(
  "%s delivery preserves a caller's pre-spent original allowance before its first attempt",
  async (kind) => {
    const f =
      kind === "restoration"
        ? await restoration()
        : await createMovieRetentionFixture("directors_cut", bytes, false);
    if (kind === "warning") {
      closers.push(f.close);
      expect(await f.warning()).toMatchObject({ status: "warning" });
    }
    const { delivery, input } = await selectedDelivery(f, kind);
    const before = await sourceHistory(f);
    const sentBefore = f.sent.length;
    const call = invocation(f);
    call.budget.consume(99);
    expect(
      await createNotificationActivities(call.context).deliverMediaNotification(
        input,
      ),
    ).toEqual({
      status: "failed",
      reason: "archive_transition_reconciliation_required",
    });
    expect(() => call.budget.consume(0)).toThrow(NativeArchiveScopeProtection);
    expect(f.sent).toHaveLength(sentBefore);
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
    expect(await sourceHistory(f)).toEqual(before);
  },
  60_000,
);

test("unconfiguring the actual movie section after claim rejects an unsent restoration attempt", async () => {
  const f = await restoration();
  const { delivery, input } = await selectedDelivery(f, "restoration");
  const before = await sourceHistory(f);
  const sentBefore = f.sent.length;
  const call = invocation(f);
  let claimed = false;
  expect(
    await createNotificationActivities({
      ...call.context,
      permittedSections: () =>
        claimed
          ? Promise.resolve({ movie: "", series: "2" })
          : f.context.permittedSections(),
      checkpoint: () => {
        claimed = true;
        return Promise.resolve();
      },
    }).deliverMediaNotification(input),
  ).toEqual({ status: "failed", reason: "authority_changed_before_send" });
  expect(claimed).toBe(true);
  expect(f.sent).toHaveLength(sentBefore);
  expect(
    await f.db.notificationDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    }),
  ).toMatchObject({
    state: "failed",
    attempts: 1,
    failureReason: "authority_changed_before_send",
    providerReceipt: null,
    acceptedAt: null,
  });
  const attempts = await f.db.notificationDeliveryAttempt.findMany({
    where: { deliveryId: delivery.id },
  });
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({
    state: "rejected",
    rejectionReason: "authority_changed_before_send",
    providerReceipt: null,
  });
  expect(await sourceHistory(f)).toEqual(before);
}, 60_000);
