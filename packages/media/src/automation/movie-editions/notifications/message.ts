import type { Prisma } from "#generated/prisma/client.ts";
import type { NotificationContext } from "#automation/notifications/types.ts";
import { movieEditionDisplayLabel } from "#shared/movie-editions/registry.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import {
  assertPreparedMovieNoticeV4,
  type MovieNoticeDelivery,
  type PreparedMovieNoticeV4,
} from "./authority.ts";

export async function composeMovieNoticeV4(
  tx: Prisma.TransactionClient,
  context: Pick<
    NotificationContext,
    "publicOrigin" | "personalDiscordAvailable"
  > & {
    movieNotice: PreparedMovieNoticeV4 | undefined;
    captureFreshness: ((guard: MovieChoiceFreshness) => void) | undefined;
  },
  delivery: MovieNoticeDelivery,
) {
  const prepared = context.movieNotice;
  if (prepared === undefined)
    throw new Error(
      "Movie notification requires its original invocation authority",
    );
  const current = await assertPreparedMovieNoticeV4(tx, delivery, prepared);
  context.captureFreshness?.(prepared.freshness);
  context.captureFreshness?.(current.choice.freshness);
  const target = await personalTarget(context, delivery);
  if (target === null) return null;
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: prepared.payload.source.scope.mediaId },
  });
  const label = movieEditionDisplayLabel(prepared.payload.source.scope.edition);
  const description =
    prepared.payload.eventKind === "media_available"
      ? "is available in Plex"
      : "has been upgraded in Plex";
  prepared.freshness.assertActive();
  current.choice.freshness.assertActive();
  const prefix = "Media: ";
  const suffix = ` (${label})`;
  return {
    ...target,
    subject: `${prefix}${media.title.slice(0, 160 - prefix.length - suffix.length)}${suffix}`,
    text: `${media.title} (${label}) ${description}.\n${new URL(`/media/${encodeURIComponent(media.id)}`, context.publicOrigin).toString()}`,
  };
}

async function personalTarget(
  context: Pick<NotificationContext, "personalDiscordAvailable">,
  delivery: MovieNoticeDelivery,
): Promise<{ channel: "email" | "discord"; recipient: string } | null> {
  const preference = delivery.user.notificationPreference;
  if (
    preference === null ||
    delivery.user.restricted ||
    (delivery.event.kind === "media_upgraded" && !preference.upgrades)
  )
    return null;
  if (delivery.channel === "email")
    return preference.emailEnabled &&
      delivery.user.emailVerifiedAt !== null &&
      delivery.user.email !== null
      ? { channel: "email", recipient: delivery.user.email }
      : null;
  if (delivery.channel === "discord")
    return preference.discordEnabled &&
      delivery.user.discordId !== null &&
      (await context.personalDiscordAvailable?.()) === true
      ? { channel: "discord", recipient: delivery.user.discordId }
      : null;
  return null;
}
