import { z } from "zod";
import { expect } from "vitest";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { createMovieCleanupFixture } from "./cleanup-fixture.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import { queueOperation } from "#automation/store.ts";
import { evaluateMovieRetentionV4 } from "#automation/movie-editions/retention/evaluate.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { quarantineMovieFilesV4 } from "#automation/movie-editions/retention/quarantine.ts";
import { restoreMovieFilesV4 } from "#automation/movie-editions/retention/restore.ts";
import { publishRestoredMovieToPlexV4 } from "#automation/movie-editions/retention/restore-plex.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** Actual A→B upgrade, accepted warning, B quarantine/restore/rebind; only policy time and remote transports are synthetic. */
export async function createRestoredMovieCleanupFixture(
  edition: MovieEditionKey,
  bytes: { original: Uint8Array; upgrade: Uint8Array },
) {
  const f = await createMovieCleanupFixture(edition, bytes);
  const page = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === `/media/${f.scope.mediaId}`
        ? new Response("Synthetic Media detail route", { status: 200 })
        : new Response(null, { status: 404 }),
  });
  try {
    const user = f.network.actor;
    await f.db.mediaUser.update({
      where: { id: user.id },
      data: {
        email: `${user.id}@restored-cleanup.fixture`,
        emailVerifiedAt: new Date(),
      },
    });
    await f.db.notificationPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, emailEnabled: true },
      update: { emailEnabled: true },
    });
    const receipts = new Map<string, string>();
    const policyNow = () => new Date(Date.now() + 8 * 86_400_000);
    const context: MediaAutomationContext = {
      ...f.context,
      now: policyNow,
      publicOrigin: page.url.origin,
      notify: (message, mutation) => {
        mutation?.beforeMutation();
        const receipt = `synthetic-restored-cleanup:${message.idempotencyKey}`;
        receipts.set(receipt, message.recipient);
        return Promise.resolve({ receipt });
      },
      reconcileNotification: (input) =>
        Promise.resolve({
          status: receipts.has(input.receipt) ? "delivered" : "unknown",
          recipient: receipts.get(input.receipt) ?? null,
        }),
    };
    const target = await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
    });
    const operationId = await f.db.$transaction((tx) =>
      queueOperation(tx, {
        key: `synthetic-restored-cleanup-retention:${crypto.randomUUID()}`,
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
    const command = await f.db.operation.findUniqueOrThrow({
      where: { id: operationId },
    });
    const retentionInput = MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(command.payload),
    );
    expect(
      await evaluateMovieRetentionV4(
        context,
        retentionInput,
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "warning" });
    const delivery = await f.db.notificationDelivery.findFirstOrThrow({
      where: {
        userId: user.id,
        channel: "email",
        event: {
          mediaId: f.scope.mediaId,
          kind: "retention_warning",
          payload: { path: ["scope", "edition"], equals: edition },
        },
      },
    });
    const notification = await f.db.operation.findFirstOrThrow({
      where: { kind: "deliver_notification", targetId: delivery.id },
    });
    expect(
      await createNotificationActivities(context).deliverMediaNotification({
        operationId: notification.id,
        notificationId: delivery.id,
      }),
    ).toEqual({ status: "accepted", reason: null });
    const evaluated = await evaluateMovieRetentionV4(
      context,
      retentionInput,
      testPlexBindingExecution(),
    );
    expect(evaluated.status).toBe("quarantine");
    const decisionId = z.uuid().parse(evaluated.decisionId);
    const files = () => {
      const execution = testPublicationExecution();
      return {
        ...f.files,
        now: policyNow,
        publicationExecution: () => execution,
        movieManagement: {
          execution,
          budget: new PublicationAuthorityReadBudget(),
        },
      };
    };
    await quarantineMovieFilesV4(files(), {
      schemaVersion: 4,
      operationId,
      decisionId,
      scope: f.scope,
    });
    const restore = await requestTestMovieV4(
      f.db,
      user,
      f.scope.mediaId,
      edition,
    );
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: restore.input.operationId },
      }),
    ).toMatchObject({ kind: "restore_movie_edition_v4" });
    await restoreMovieFilesV4(files(), restore.input);
    expect(
      await publishRestoredMovieToPlexV4(
        context,
        restore.input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "available", reason: null });
    return {
      ...f,
      context,
      retentionInput,
      restoreInput: restore.input,
      decisionId,
      close: async () => {
        try {
          await page.stop(true);
        } finally {
          await f.close();
        }
      },
    };
  } catch (error) {
    try {
      await page.stop(true);
    } finally {
      await f.close();
    }
    throw error;
  }
}
