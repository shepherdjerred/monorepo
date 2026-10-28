import type { Prisma } from "#generated/prisma/client.ts";
import type { NotificationContext } from "#automation/notifications/types.ts";
import type { MovieNoticeDelivery } from "#automation/movie-editions/notifications/authority.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import { movieEditionDisplayLabel } from "#shared/movie-editions/registry.ts";
import {
  assertPreparedMovieInterventionV4,
  type PreparedMovieInterventionV4,
} from "./authority.ts";

export async function composeMovieInterventionV4(
  tx: Prisma.TransactionClient,
  context: Pick<
    NotificationContext,
    "publicOrigin" | "personalDiscordAvailable"
  > & {
    movieIntervention?: PreparedMovieInterventionV4;
    captureFreshness?: ((guard: MovieChoiceFreshness) => void) | undefined;
  },
  delivery: MovieNoticeDelivery,
) {
  const prepared = context.movieIntervention;
  if (prepared === undefined)
    throw new Error(
      "Movie intervention requires its original invocation authority",
    );
  const identity = await assertPreparedMovieInterventionV4(
    tx,
    delivery,
    prepared,
  );
  context.captureFreshness?.(prepared.freshness);
  context.captureFreshness?.(identity);
  const recipient = await interventionRecipient(context, delivery);
  if (recipient === null) return null;
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: prepared.payload.source.mediaId },
  });
  const label = movieEditionDisplayLabel(prepared.payload.source.scope.edition);
  const suffix = ` (${label})`;
  const action =
    prepared.payload.recipient.kind === "owner"
      ? "needs owner attention"
      : "needs attention";
  prepared.freshness.assertActive();
  identity.assertActive();
  return {
    ...recipient,
    subject: `Media: ${media.title.slice(0, 153 - suffix.length)}${suffix}`,
    text: `${media.title} (${label}) ${action}.\n${new URL(`/media/${encodeURIComponent(media.id)}`, context.publicOrigin).toString()}`,
  };
}

async function interventionRecipient(
  context: Pick<NotificationContext, "personalDiscordAvailable">,
  delivery: MovieNoticeDelivery,
): Promise<{ channel: "email" | "discord"; recipient: string } | null> {
  const preference = delivery.user.notificationPreference;
  if (preference === null || delivery.user.restricted) return null;
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
