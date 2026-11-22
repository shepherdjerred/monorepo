import type { Prisma } from "#generated/prisma/client.ts";
import type { VisibleMedia } from "#infrastructure/visibility/access.ts";
import {
  libraryKeepingView,
  libraryPolicyInclude,
  titleFollowers,
} from "#infrastructure/library/views/policy.ts";

/** The claims the library's policy reads, each with the name of whose it is. */
const householdInclude = {
  intents: libraryPolicyInclude.intents,
  requests: {
    select: {
      ...libraryPolicyInclude.requests.select,
      user: { select: { displayName: true } },
    },
  },
} as const;

/**
 * What the household makes of one root title: how long it is kept, by the
 * derivation `GET /library` uses for the titles it lists, and who follows it.
 * One lookup, whatever the title holds.
 *
 * Keeping follows the title's default target, not the list's membership: a
 * title the list has stopped showing still reports its keeping, so an owner who
 * turned its Keep off can turn it back on.
 *
 * `followers` is null when the names are withheld: from an account the owner
 * restricted, and for a title in a Plex library the reader may not open, which
 * also reports `unclassified` and no switch.
 */
export async function readTitleHousehold(
  tx: Prisma.TransactionClient,
  root: VisibleMedia & { id: string },
  reader: {
    actorId: string;
    owner: boolean;
    restricted: boolean;
    visible: (item: VisibleMedia) => boolean;
  },
) {
  if (!reader.visible(root))
    return {
      policy: "unclassified" as const,
      libraryKeeping: null,
      followers: null,
    };
  const title = await tx.mediaItem.findUniqueOrThrow({
    where: { id: root.id },
    include: householdInclude,
  });
  const { policy, libraryKeeping } = libraryKeepingView(title, reader);
  return {
    policy,
    libraryKeeping,
    followers: reader.restricted ? null : titleFollowers(title, reader.actorId),
  };
}
