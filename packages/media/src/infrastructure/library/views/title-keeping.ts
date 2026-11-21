import type { Prisma } from "#generated/prisma/client.ts";
import type { VisibleMedia } from "#infrastructure/visibility/access.ts";
import {
  libraryKeepingView,
  libraryMemberWhere,
  libraryPolicyInclude,
} from "#infrastructure/library/views/policy.ts";

/**
 * How long the household keeps one root title, as `GET /library` would report
 * the same title to this reader. One lookup, whatever the title holds.
 *
 * A title that list would not show the reader (not a movie or series, held by
 * nothing, or in a Plex library the reader may not open) has no keeping to
 * report: it is `unclassified`, and there is no switch to offer.
 */
export async function readTitleKeeping(
  tx: Prisma.TransactionClient,
  root: VisibleMedia & { id: string },
  reader: {
    actorId: string;
    owner: boolean;
    visible: (item: VisibleMedia) => boolean;
  },
) {
  const title = reader.visible(root)
    ? await tx.mediaItem.findFirst({
        where: {
          AND: [
            { id: root.id, kind: { in: ["movie", "series"] } },
            libraryMemberWhere,
          ],
        },
        include: libraryPolicyInclude,
      })
    : null;
  if (title === null)
    return { policy: "unclassified" as const, libraryKeeping: null };
  const { policy, libraryKeeping } = libraryKeepingView(title, reader);
  return { policy, libraryKeeping };
}
