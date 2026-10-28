import { z } from "zod";
import { expect } from "vitest";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { createPublishedMovieFixture } from "./upgrade-fixture.ts";
import { queueOperation } from "#automation/store.ts";
import { createNotificationActivities } from "#automation/notifications.ts";
import { evaluateMovieRetentionV4 } from "#automation/movie-editions/retention/evaluate.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/automation-v4.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { createManagedMovieFixture } from "./managed-fixture.ts";
import { rm } from "node:fs/promises";

/** Only retention policy time advances; publication, warning, receipt and authority clocks stay real. */
export async function createMovieRetentionFixture(
  edition: MovieEditionKey,
  bytes: Uint8Array,
  elapsed = true,
) {
  const f = await createPublishedMovieFixture(edition, bytes);
  const { db, user, context: base } = f.source;
  const page = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === `/media/${f.scope.mediaId}`
        ? new Response("Synthetic Media detail route", { status: 200 })
        : new Response(null, { status: 404 }),
  });
  try {
    await db.mediaUser.update({
      where: { id: user.id },
      data: {
        email: `${user.id}@retention.fixture`,
        emailVerifiedAt: new Date(),
      },
    });
    await db.notificationPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, emailEnabled: true },
      update: { emailEnabled: true },
    });
    const sent: Parameters<MediaAutomationContext["notify"]>[0][] = [];
    const receipts = new Map<string, string>();
    const context: MediaAutomationContext = {
      ...base,
      now: () => new Date(Date.now() + (elapsed ? 8 * 86_400_000 : 0)),
      publicOrigin: page.url.origin,
      notify: (message, mutation) => {
        mutation?.beforeMutation();
        sent.push(message);
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
    const target = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
    });
    const operationId = await db.$transaction((tx) =>
      queueOperation(tx, {
        key: `synthetic-movie-retention:${crypto.randomUUID()}`,
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
    const operation = await db.operation.findUniqueOrThrow({
      where: { id: operationId },
    });
    const input = MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(operation.payload),
    );
    return {
      ...f,
      db,
      context,
      sent,
      input,
      publicationOperationId: f.input.operationId,
      warning: () =>
        evaluateMovieRetentionV4(context, input, testPlexBindingExecution()),
      evaluate: () =>
        evaluateMovieRetentionV4(context, input, testPlexBindingExecution()),
      async deliverWarning() {
        const delivery = await db.notificationDelivery.findFirstOrThrow({
          where: {
            userId: user.id,
            channel: "email",
            event: {
              mediaId: f.scope.mediaId,
              kind: "retention_warning",
              payload: { path: ["scope", "edition"], equals: edition },
            },
          },
          include: { event: true },
        });
        const command = await db.operation.findFirstOrThrow({
          where: { kind: "deliver_notification", targetId: delivery.id },
        });
        expect(
          await createNotificationActivities(context).deliverMediaNotification({
            operationId: command.id,
            notificationId: delivery.id,
          }),
        ).toEqual({ status: "accepted", reason: null });
        return delivery;
      },
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

/** Actual initial-library approval/binding, retaining its unresolved household-history hold. */
export async function createAdoptedMovieRetentionFixture(
  edition: MovieEditionKey,
  bytes: Uint8Array,
) {
  const cluster = await startMediaTestPostgres();
  const db = cluster.database;
  const directories: string[] = [];
  const close = async () => {
    try {
      await cluster.close();
    } finally {
      for (const directory of directories)
        await rm(directory, { recursive: true, force: true });
    }
  };
  try {
    const f = await createManagedMovieFixture(
      { database: () => db },
      edition,
      (directory) => directories.push(directory),
      { original: bytes, upgrade: bytes },
    );
    const operationId = await db.$transaction((tx) =>
      queueOperation(tx, {
        key: `synthetic-adopted-retention:${crypto.randomUUID()}`,
        kind: "retain_movie_edition_v4",
        targetId: f.scope.mediaId,
        payload: {
          schemaVersion: 4,
          scope: f.scope,
          mediaId: f.scope.mediaId,
          generation: f.input.generation,
        },
      }),
    );
    const input = MovieOperationV4Schema.parse({
      schemaVersion: 4,
      operationId,
      scope: f.scope,
      mediaId: f.scope.mediaId,
      generation: f.input.generation,
    });
    return {
      ...f,
      db,
      input,
      close,
      evaluate: () =>
        evaluateMovieRetentionV4(f.context, input, testPlexBindingExecution()),
    };
  } catch (error) {
    await close();
    throw error;
  }
}
