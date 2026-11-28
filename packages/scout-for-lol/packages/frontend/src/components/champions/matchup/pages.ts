import type { MetaRole } from "@scout-for-lol/data/meta/meta-serving.ts";
import { roleSlug } from "#src/lib/champion-meta/snapshot.ts";
import type { SnapshotChampion } from "#src/lib/champion-meta/snapshot-v2-schema.ts";

/**
 * Which matchup pages exist. A page is generated for exactly the opponents a
 * champion file lists, because each listed opponent has one matchup file, so
 * a link is drawn only to a pair this module names.
 */

export type ListedMatchup = {
  /** The champion whose side the page is written from. */
  slug: string;
  role: MetaRole;
  opponent: string;
};

export function matchupHref(
  slug: string,
  role: MetaRole,
  opponentSlug: string,
): string {
  return `/champions/${slug}/${roleSlug(role)}/vs/${opponentSlug}/`;
}

/** Every matchup page the snapshot has data for. */
export function listedMatchups(
  champions: readonly SnapshotChampion[],
): ListedMatchup[] {
  return champions.flatMap((champion) =>
    champion.matchups.flatMap((group) =>
      group.opponents.map((opponent) => ({
        slug: champion.slug,
        role: group.role,
        opponent: opponent.slug,
      })),
    ),
  );
}

/** The opponent slugs of `champion` in `role` that have a matchup page. */
export function pageOpponents(
  champion: SnapshotChampion,
  role: MetaRole,
): ReadonlySet<string> {
  const group = champion.matchups.find((entry) => entry.role === role);
  return new Set(group?.opponents.map((opponent) => opponent.slug));
}
