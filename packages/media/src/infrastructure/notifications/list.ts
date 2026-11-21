import type { MediaActor } from "#application/auth.ts";
import type { Database } from "#infrastructure/database.ts";
import {
  mediaReference,
  mediaReferenceSelect,
} from "#infrastructure/library/views/artwork.ts";
import { NotificationListSchema, type NotificationList } from "#shared/api.ts";
import { InterestCheckNoticeSchema } from "#shared/household/interests.ts";
import type { MediaReference } from "#shared/household/media-reference.ts";
import { OwnerHealthSchema } from "#shared/notification-authority.ts";

/**
 * The title a delivery's event is about, for the person reading their own
 * deliveries. Every event that names an item is addressed either to people who
 * asked for that item, whose message already names it, or to owners. An
 * intervention is the owner-addressed kind, so its title is named only while
 * the reader is an owner: a delivery outlives a change of owner account, and a
 * message that had not been sent by then is never composed.
 *
 * Null as well when the event names no item or the item no longer exists.
 */
export function notificationEventMedia(
  actor: Pick<MediaActor, "role">,
  event: { mediaId: string | null; kind: string },
  titles: ReadonlyMap<string, MediaReference>,
): MediaReference | null {
  if (event.mediaId === null) return null;
  return event.kind === "system_intervention" && actor.role !== "owner"
    ? null
    : (titles.get(event.mediaId) ?? null);
}

/** One lookup for every title the page's events name, none per delivery. */
async function readEventTitles(
  db: Database,
  events: readonly { mediaId: string | null }[],
): Promise<ReadonlyMap<string, MediaReference>> {
  const mediaIds = [...new Set(events.flatMap((event) => event.mediaId ?? []))];
  if (mediaIds.length === 0) return new Map();
  const titles = await db.mediaItem.findMany({
    where: { id: { in: mediaIds } },
    select: mediaReferenceSelect,
  });
  return new Map(titles.map((title) => [title.id, mediaReference(title)]));
}

/**
 * A person's own deliveries, newest first. One event is delivered once per
 * channel, so rows that share `event.id` are the same notification.
 */
export async function readNotificationList(
  db: Database,
  actor: MediaActor,
): Promise<NotificationList> {
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const deliveries = await db.notificationDelivery.findMany({
    where: { userId: actor.id },
    select: {
      id: true,
      channel: true,
      state: true,
      version: true,
      failureReason: true,
      providerStatus: true,
      attempts: true,
      acceptedAt: true,
      createdAt: true,
      event: { select: { id: true, mediaId: true, kind: true, payload: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const titles = await readEventTitles(
    db,
    deliveries.map((delivery) => delivery.event),
  );
  return NotificationListSchema.parse(
    deliveries.map(({ event, ...delivery }) => {
      const interest =
        event.kind === "interest_check"
          ? InterestCheckNoticeSchema.parse(event.payload)
          : null;
      const proof =
        event.kind === "owner_health"
          ? OwnerHealthSchema.safeParse(event.payload)
          : null;
      return {
        ...delivery,
        event: {
          id: event.id,
          mediaId: event.mediaId,
          kind: event.kind,
          media: notificationEventMedia(actor, event, titles),
          ...(interest?.userId === actor.id
            ? {
                interestRequestId: interest.requestId,
                interestRevision: interest.interestRevision,
              }
            : {}),
          ...(proof === null
            ? {}
            : proof.success
              ? {
                  healthReason: proof.data.reason,
                  healthState:
                    runtime.recoveryEpoch === proof.data.recoveryEpoch &&
                    runtime.version === proof.data.runtimeVersion &&
                    runtime.mode === "observe" &&
                    !runtime.ownershipConfirmed
                      ? "current"
                      : "superseded",
                }
              : { healthState: "invalid" }),
        },
      };
    }),
  );
}
