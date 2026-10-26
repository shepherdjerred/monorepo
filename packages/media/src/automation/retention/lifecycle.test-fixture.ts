import { rm } from "node:fs/promises";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { fileFixture } from "#automation/files/test-support.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import {
  observeRequesterWatch,
  queueRetentionCheck,
} from "#automation/watch.ts";
import { createRetentionActivities } from "#automation/retention.ts";
import {
  bindingTestExecution,
  preparePhysicalPublication,
} from "#automation/plex-binding/test-fixture.ts";
import { retentionPlexContext } from "./fixtures/plex.ts";
import {
  elapsedWarningClient,
  warningHistory,
  assertWarningHistory,
} from "./fixtures/elapsed.ts";

type Files = Awaited<ReturnType<typeof fileFixture>>;
type Published = Awaited<ReturnType<Files["published"]>>;

/** The caller owns its already-produced mapped files, including any real caption work. */
export async function prepareBoundRetention(
  files: Files,
  published: Published,
  base: MediaAutomationContext,
) {
  if (files.context.pathMapping === undefined)
    throw new Error(
      "Bound retention requires canonical mapping before the first publication",
    );
  const db = files.context.db;
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: published.attempt.id },
  });
  const transport = await retentionPlexContext(db, base, attempt.mediaIds);
  const receipts = new Map<string, string>();
  const context: MediaAutomationContext = {
    ...transport.context,
    plexBindingExecution: bindingTestExecution,
    notify: (message, mutation) => {
      mutation?.beforeMutation();
      const receipt = `synthetic-warning:${message.idempotencyKey}`;
      receipts.set(receipt, message.recipient);
      return Promise.resolve({ receipt });
    },
    reconcileNotification: (input) =>
      Promise.resolve({
        status: receipts.has(input.receipt) ? "delivered" : "unknown",
        recipient: receipts.get(input.receipt) ?? null,
      }),
  };
  await prepareRequesters(db, context, attempt.mediaIds);
  const publication = createPublicationActivities(context);
  const available = await publication.publishMediaToPlex(published.input);
  if (available.status !== "available")
    throw new Error(
      `Actual retention publication failed: ${JSON.stringify(available)}`,
    );
  await publication.finalizeMediaAcquisition(published.input);
  for (const mediaId of attempt.mediaIds) {
    const watch = await observeRequesterWatch(context, mediaId);
    if (!watch.complete)
      throw new Error(
        `Actual retention watch failed: ${JSON.stringify(watch)}`,
      );
  }
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: files.media.id, edition: "default" } },
  });
  const bucket = `bound-retention-fixture:${crypto.randomUUID()}`;
  await queueRetentionCheck(context, target.mediaId, bucket);
  const operation = await db.operation.findUniqueOrThrow({
    where: {
      idempotencyKey: `retention:${target.mediaId}:${String(target.generation)}:${bucket}`,
    },
  });
  const input = z
    .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
    .parse(operation.payload);
  // Only original warning writes see historical fixture timestamps. Authority clocks remain real.
  const historicalDb = elapsedWarningClient(db, attempt.mediaIds);
  const historicalContext = { ...context, db: historicalDb };
  const warning =
    await createRetentionActivities(historicalContext).evaluateMediaRetention(
      input,
    );
  if (warning.status !== "warning" || warning.decisionId === null)
    throw new Error(
      `Actual retention warning failed: ${JSON.stringify(warning)}`,
    );
  const decisions = await db.retentionDecision.findMany({
    where: {
      mediaId: { in: attempt.mediaIds },
      state: "warning_pending",
      edition: "default",
    },
  });
  for (const decision of decisions) {
    const eventId = z
      .object({ warningEventId: z.string() })
      .parse(decision.evidence).warningEventId;
    const deliveries = await db.notificationDelivery.findMany({
      where: { eventId },
    });
    if (deliveries.length === 0)
      throw new Error("Actual warning producer omitted recipient delivery");
    for (const delivery of deliveries) {
      const command = await db.operation.findFirstOrThrow({
        where: { kind: "deliver_notification", targetId: delivery.id },
      });
      const result = await createNotificationActivities(
        historicalContext,
      ).deliverMediaNotification({
        operationId: command.id,
        notificationId: delivery.id,
      });
      if (result.status !== "accepted")
        throw new Error(
          `Actual warning acceptance failed: ${JSON.stringify(result)}`,
        );
    }
  }
  const history = await Promise.all(
    decisions.map(async (decision) => ({
      decisionId: decision.id,
      value: await warningHistory(db, decision.id),
    })),
  );
  const assertHistory = async () => {
    for (const original of history)
      await assertWarningHistory(db, original.decisionId, original.value);
  };
  const evaluate = () =>
    createRetentionActivities(context).evaluateMediaRetention(input);
  const due = await evaluate();
  if (due.status !== "quarantine" || due.decisionId !== warning.decisionId)
    throw new Error(
      `Actual elapsed-grace evaluation failed: ${JSON.stringify(due)}`,
    );
  await assertHistory();
  let retention = {
    decision: await db.retentionDecision.findUniqueOrThrow({
      where: { id: warning.decisionId },
    }),
    input: { operationId: operation.id, decisionId: warning.decisionId },
  };
  let offset = 0;
  files.context.now = () => new Date(Date.now() + offset);
  files.advance = (milliseconds) => {
    offset += milliseconds;
  };
  const refresh = async () => {
    const result = await evaluate();
    await assertHistory();
    if (result.decisionId !== null)
      retention = {
        decision: await db.retentionDecision.findUniqueOrThrow({
          where: { id: result.decisionId },
        }),
        input: { operationId: operation.id, decisionId: result.decisionId },
      };
    return result;
  };
  const observe = async (watched: boolean | null) => {
    transport.state.watched = watched;
    const observations = [];
    for (const mediaId of attempt.mediaIds)
      observations.push(await observeRequesterWatch(context, mediaId));
    return observations;
  };
  return {
    files,
    published,
    ...transport,
    context,
    operation,
    input,
    history,
    asset: await db.libraryAsset.findUniqueOrThrow({
      where: { id: published.entry.assetId },
    }),
    get retention() {
      return retention;
    },
    evaluate,
    refresh,
    observe,
    resetFileClock: () => {
      offset = 0;
    },
    quarantine: () =>
      createMediaFileActivities(files.context).quarantineMediaFiles(
        retention.input,
      ),
  };
}

/** Real producers plus injected HTTP; eight-day grace is an explicitly simulated fixture precondition. */
export async function boundRetentionFixture(
  db: Database,
  network: MediaAutomationContext,
) {
  const files = await mappedPublicationFixture(db);
  try {
    return await prepareBoundRetention(
      files,
      await preparePhysicalPublication(files),
      network,
    );
  } catch (error) {
    await rm(files.directory, { recursive: true, force: true });
    throw error;
  }
}

async function prepareRequesters(
  db: Database,
  context: MediaAutomationContext,
  mediaIds: string[],
) {
  const requests = await db.mediaRequest.findMany({
    where: { mediaId: { in: mediaIds }, active: true, excluded: false },
    select: { userId: true },
  });
  const requesterIds = [...new Set(requests.map((row) => row.userId))];
  for (const id of requesterIds) {
    const user = await db.mediaUser.update({
      where: { id },
      data: {
        email: `${id}@retention.fixture`,
        emailVerifiedAt: new Date(),
        notificationPreference: {
          upsert: {
            create: { emailEnabled: true },
            update: { emailEnabled: true },
          },
        },
      },
    });
    const credentials = await db.credential.findMany({
      where: { userId: id, kind: "plex" },
    });
    if (credentials.length > 0)
      throw new Error(
        "Retention fixture requires an explicit fresh requester credential",
      );
    await db.credential.create({
      data: {
        userId: id,
        kind: "plex",
        ciphertext: context.cipher.encrypt(
          JSON.stringify({ serverToken: `synthetic-requester:${id}` }),
          `plex:${user.plexAccountId}`,
        ),
      },
    });
  }
}
