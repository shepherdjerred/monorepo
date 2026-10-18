import { MediaCommandBase } from "#infrastructure/command-base.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { CredentialCipher } from "#application/security.ts";
import { lockDelivery } from "#automation/notifications/locks.ts";
import { deliveryAuthority } from "#automation/notifications/authority.ts";
import {
  composeMessage,
  deliveryInclude,
  eventMediaIds,
} from "#automation/notifications/message.ts";
import { queueDelivery } from "#automation/notifications/events.ts";
import { CommandResultSchema } from "#shared/api.ts";
import {
  requireMovieChoiceAccess,
  type MovieChoiceAccess,
} from "#infrastructure/movie-editions/access.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";

export class NotificationDeliveryCommands extends MediaCommandBase {
  constructor(
    private readonly deliveryDatabase: Database,
    private readonly deliveryCipher: CredentialCipher,
    private readonly publicOrigin: string,
    private readonly deliveryOptions: {
      personalDiscordAvailable?: (() => Promise<boolean>) | undefined;
      movieAccess?: (() => Promise<MovieChoiceAccess>) | undefined;
    } = {},
  ) {
    super(deliveryDatabase, { keepDays: 30 });
  }

  private readonly personalDiscordAvailable = () =>
    this.deliveryOptions.personalDiscordAvailable?.() ?? Promise.resolve(false);

  retryDelivery(
    actor: MediaActor,
    key: string,
    id: string,
    expectedVersion: number,
  ) {
    let movieAccess: MovieChoiceAccess | undefined;
    let guards: MovieChoiceFreshness[] = [];
    return this.commandWithProtocol(
      actor,
      key,
      {
        command: { kind: "retry_notification", input: { id, expectedVersion } },
        decode: (value) => CommandResultSchema.parse(value),
        beforeNewCommand: async () => {
          const delivery =
            await this.deliveryDatabase.notificationDelivery.findUniqueOrThrow({
              where: { id },
              include: deliveryInclude,
            });
          if (delivery.userId !== actor.id)
            throw new MediaError(
              "forbidden",
              "Only the recipient can retry this delivery",
              403,
            );
          if (
            ![
              "media_available",
              "media_upgraded",
              "subtitles_ready",
              "retention_warning",
            ].includes(delivery.event.kind)
          )
            return;
          const movie = await this.deliveryDatabase.mediaItem.findFirst({
            where: { id: { in: eventMediaIds(delivery) }, kind: "movie" },
          });
          if (movie !== null)
            movieAccess = requireMovieChoiceAccess(
              (await this.deliveryOptions.movieAccess?.()) ?? {},
            );
        },
        assertCommit: () => {
          for (const guard of guards) guard.assertActive();
        },
      },
      async (tx) => {
        guards = [];
        const delivery = await lockDelivery(tx, id);
        if (delivery.userId !== actor.id)
          throw new MediaError(
            "forbidden",
            "Only the recipient can retry this delivery",
            403,
          );
        const bounced =
          delivery.state === "accepted" &&
          delivery.providerStatus === "bounced";
        if (
          delivery.version !== expectedVersion ||
          (!bounced && delivery.state !== "failed")
        )
          throw new MediaError(
            "delivery_conflict",
            "Refresh the delivery before retrying",
            409,
          );
        if ((await deliveryAuthority(tx, delivery)) !== null)
          throw new MediaError(
            "delivery_protected",
            "This delivery belongs to an inactive recovery epoch",
            409,
          );
        const attempt = await tx.notificationDeliveryAttempt.findFirst({
          where: { deliveryId: id },
          orderBy: { attemptNumber: "desc" },
        });
        if (
          attempt?.recoveryEpoch !== delivery.recoveryEpoch ||
          (!bounced &&
            (attempt.state !== "rejected" ||
              attempt.providerReceipt !== null)) ||
          delivery.attempts >= 3
        )
          throw new MediaError(
            "delivery_retry_unsafe",
            "Only a confirmed rejection or bounce can be retried, at most three times",
            409,
          );
        if (Date.now() - attempt.startedAt.getTime() < 60_000)
          throw new MediaError(
            "delivery_retry_wait",
            "Wait one minute before retrying",
            429,
          );
        const message = await composeMessage(
          tx,
          {
            cipher: this.deliveryCipher,
            publicOrigin: this.publicOrigin,
            personalDiscordAvailable: this.personalDiscordAvailable,
            movieAccess,
            captureFreshness: (guard) => guards.push(guard),
          },
          delivery,
        );
        if (message === null)
          throw new MediaError(
            "delivery_obsolete",
            "The event or recipient is no longer eligible",
            409,
          );
        await tx.notificationDelivery.update({
          where: { id },
          data: {
            state: "pending",
            failureReason: null,
            acceptedAt: null,
            providerReceipt: null,
            providerStatus: null,
            reconciledAt: null,
            version: { increment: 1 },
          },
        });
        await queueDelivery(
          tx,
          id,
          actor.id,
          `notification-retry:${id}:${String(expectedVersion)}`,
        );
        return { status: "queued", version: expectedVersion + 1 };
      },
    );
  }

  reconcileDelivery(
    actor: MediaActor,
    key: string,
    id: string,
    input: { expectedVersion: number; receipt?: string },
  ) {
    return this.command(
      actor,
      key,
      { kind: "reconcile_notification", input: { id, ...input } },
      async (tx) => {
        const delivery = await lockDelivery(tx, id);
        if (delivery.userId !== actor.id && actor.role !== "owner")
          throw new MediaError(
            "forbidden",
            "This delivery belongs to another recipient",
            403,
          );
        if (
          delivery.version !== input.expectedVersion ||
          !["sending", "unknown", "accepted"].includes(delivery.state)
        )
          throw new MediaError(
            "delivery_conflict",
            "Refresh the delivery before checking its receipt",
            409,
          );
        if ((await deliveryAuthority(tx, delivery)) !== null)
          throw new MediaError(
            "delivery_protected",
            "Restored delivery attempts cannot be authorized again",
            409,
          );
        const attempt = await tx.notificationDeliveryAttempt.findFirst({
          where: { deliveryId: id },
          orderBy: { attemptNumber: "desc" },
        });
        if (attempt?.recoveryEpoch !== delivery.recoveryEpoch)
          throw new MediaError(
            "delivery_receipt_missing",
            "This historical delivery has no verifiable attempt journal",
            409,
          );
        if (
          ["owner_health", "email_verification"].includes(delivery.event.kind)
        ) {
          const message = await composeMessage(
            tx,
            {
              cipher: this.deliveryCipher,
              publicOrigin: this.publicOrigin,
              personalDiscordAvailable: this.personalDiscordAvailable,
            },
            delivery,
          );
          if (
            message === null ||
            this.deliveryCipher.fingerprint(
              `${message.channel}:${message.recipient}`,
              "notification-recipient",
            ) !== attempt.recipientFingerprint
          )
            throw new MediaError(
              "delivery_protected",
              "The current recipient no longer matches this attempt",
              409,
            );
        }
        if (input.receipt !== undefined) {
          if (actor.role !== "owner")
            throw new MediaError(
              "forbidden",
              "An owner must supply provider evidence",
              403,
            );
          if (
            attempt.providerReceipt !== null &&
            attempt.providerReceipt !== input.receipt
          )
            throw new MediaError(
              "receipt_conflict",
              "The original receipt cannot be replaced",
              409,
            );
          await tx.notificationDeliveryAttempt.update({
            where: { id: attempt.id },
            data: { providerReceipt: input.receipt },
          });
        } else if (attempt.providerReceipt === null)
          throw new MediaError(
            "delivery_receipt_missing",
            "Provide an exact provider receipt; uncertain sends cannot be resent",
            409,
          );
        await tx.notificationDelivery.update({
          where: { id },
          data: { reconciledAt: null, version: { increment: 1 } },
        });
        await queueDelivery(
          tx,
          id,
          delivery.userId,
          `notification-receipt:${id}:${String(input.expectedVersion)}`,
        );
        return { status: "queued", version: input.expectedVersion + 1 };
      },
    );
  }
}
