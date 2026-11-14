import type { Prisma } from "#generated/prisma/client.ts";
import { InterestCheckNoticeSchema } from "#shared/household/interests.ts";
import { personalTarget, type Delivery } from "./recipient.ts";

/** A private reminder is bound to one current request interest, never shared. */
export async function composeInterestCheck(
  tx: Prisma.TransactionClient,
  publicOrigin: string,
  delivery: Delivery,
) {
  if (delivery.channel === "discord_shared") return null;
  const proof = InterestCheckNoticeSchema.parse(delivery.event.payload);
  if (
    proof.userId !== delivery.userId ||
    proof.mediaId !== delivery.event.mediaId
  )
    return null;
  const request = await tx.mediaRequest.findUnique({
    where: { id: proof.requestId },
    include: { media: { select: { title: true } } },
  });
  if (
    request?.userId !== proof.userId ||
    request.mediaId !== proof.mediaId ||
    request.edition !== proof.edition ||
    !request.active ||
    request.keepingPolicy !== "temporary" ||
    request.interestState !== "following" ||
    request.interestRevision !== proof.interestRevision ||
    request.interestNoticeRevision !== proof.interestRevision ||
    request.interestNoticeEventId !== delivery.eventId
  )
    return null;
  const target = personalTarget(delivery);
  if (target === null) return null;
  const title = request.media.title.slice(0, 180);
  const page = new URL("/requests", publicOrigin);
  page.searchParams.set("interest", request.id);
  return {
    ...target,
    subject: `Still watching ${title}?`,
    text: [
      `You have unwatched content available for ${title}.`,
      "Choose Keep watching within 7 days to continue following it, or Finished or Drop if you are done. Watching also renews your interest.",
      "If you do not reply, your temporary interest will expire. The title stays while anyone else still wants it. Otherwise it has 7 days in Leaving Soon, followed by 7 days in recoverable quarantine.",
      "Opening this link does not change your request.",
      page.toString(),
    ].join("\n\n"),
  };
}
