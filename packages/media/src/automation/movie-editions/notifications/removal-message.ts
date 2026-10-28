import type { Prisma } from "#generated/prisma/client.ts";
import type { NotificationContext } from "#automation/notifications/types.ts";
import type { MovieNoticeDelivery } from "./authority.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { movieEditionDisplayLabel } from "#shared/movie-editions/registry.ts";
import {
  assertPreparedMovieRemovalNoticeV4,
  type PreparedMovieRemovalNoticeV4,
} from "./removal-authority.ts";

export async function composeMovieRemovalNoticeV4(
  tx: Prisma.TransactionClient,
  context: Pick<
    NotificationContext,
    "publicOrigin" | "personalDiscordAvailable"
  > & {
    movieRemoval?: PreparedMovieRemovalNoticeV4;
    captureFreshness?: ((guard: MovieChoiceFreshness) => void) | undefined;
  },
  delivery: MovieNoticeDelivery,
) {
  const prepared = context.movieRemoval;
  if (prepared === undefined)
    throw new Error(
      "Movie removal notice requires its original invocation authority",
    );
  const current = await assertPreparedMovieRemovalNoticeV4(
    tx,
    delivery,
    prepared,
  );
  context.captureFreshness?.(prepared.freshness);
  context.captureFreshness?.(current);
  const target = await removalRecipient(context, delivery);
  if (target === null) return null;
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: prepared.payload.source.scope.mediaId },
  });
  const label = movieEditionDisplayLabel(prepared.payload.source.scope.edition);
  const action =
    prepared.payload.source.stage === "quarantined"
      ? "has been moved to quarantine"
      : "has been permanently removed";
  prepared.freshness.assertActive();
  current.assertActive();
  const prefix = "Media: ",
    suffix = ` (${label})`;
  return {
    ...target,
    subject: `${prefix}${media.title.slice(0, 160 - prefix.length - suffix.length)}${suffix}`,
    text: `${media.title} (${label}) ${action}.\n${new URL(`/media/${encodeURIComponent(media.id)}`, context.publicOrigin).toString()}`,
  };
}

async function removalRecipient(
  context: Pick<NotificationContext, "personalDiscordAvailable">,
  delivery: MovieNoticeDelivery,
): Promise<{ channel: "email" | "discord"; recipient: string } | null> {
  const preference = delivery.user.notificationPreference;
  if (preference?.removalCompleted !== true || delivery.user.restricted)
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
