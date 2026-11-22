import type { Prisma } from "#generated/prisma/client.ts";
import type { VisibleMedia } from "#infrastructure/visibility/access.ts";
import {
  libraryKeepingView,
  libraryPolicyInclude,
} from "#infrastructure/library/views/policy.ts";

/**
 * How long the household keeps one root title, by the derivation `GET /library`
 * uses for the titles it lists. One lookup, whatever the title holds.
 *
 * This read follows the title's default target, not the list's membership: a
 * title the list has stopped showing still reports its keeping, so an owner who
 * turned its Keep off can turn it back on. Only a title in a Plex library the
 * reader may not open reports nothing: `unclassified`, and no switch.
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
  if (!reader.visible(root))
    return { policy: "unclassified" as const, libraryKeeping: null };
  const title = await tx.mediaItem.findUniqueOrThrow({
    where: { id: root.id },
    include: libraryPolicyInclude,
  });
  const { policy, libraryKeeping } = libraryKeepingView(title, reader);
  return { policy, libraryKeeping };
}
