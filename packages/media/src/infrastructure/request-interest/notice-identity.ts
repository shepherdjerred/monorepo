import type {
  ApplicationEvent,
  MediaRequest,
} from "#generated/prisma/client.ts";
import { InterestCheckNoticeSchema } from "#shared/household/interests.ts";

type NoticeEvent = Pick<
  ApplicationEvent,
  "id" | "kind" | "mediaId" | "payload" | "createdAt"
>;

export function currentInterestNotice(
  request: MediaRequest,
  event: NoticeEvent | null | undefined,
): NoticeEvent | null {
  if (
    request.interestNoticeEventId === null ||
    request.interestNoticeRevision !== request.interestRevision ||
    event?.kind !== "interest_check" ||
    event.id !== request.interestNoticeEventId ||
    event.mediaId !== request.mediaId
  )
    return null;
  const notice = InterestCheckNoticeSchema.parse(event.payload);
  return [
    notice.requestId === request.id,
    notice.userId === request.userId,
    notice.mediaId === request.mediaId,
    notice.edition === request.edition,
    notice.interestRevision === request.interestRevision,
  ].every(Boolean)
    ? event
    : null;
}
