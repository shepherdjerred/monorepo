import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable } from "#automation/store.ts";
import { artworkRootBackfillTurn } from "#domain/household/artwork-backfill.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  catalogArtwork,
  persistCatalogArtwork,
  type CatalogArtwork,
} from "#infrastructure/catalog-identity/persist.ts";
import { lockCanonicalMedia } from "#infrastructure/editions/locks.ts";
import { IntegrationError } from "#integrations/http.ts";

/**
 * A movie or series that has no default target and whose artwork has never
 * been observed. The due pages read only rows that have a default target, so
 * no page ever meets one of these.
 */
const waiting = {
  kind: { in: ["movie", "series"] },
  tmdbId: { not: null },
  artworkObservedAt: null,
  intents: { none: { edition: "default" } },
} as const satisfies Prisma.MediaItemWhereInput;

type WaitingRoot = { id: string; kind: string; tmdbId: number | null };

/**
 * Observes artwork for this period's turn of the roots that have no default
 * target, and nothing else about them. A root with a default target is
 * refreshed by `refresh_catalog`; that refresh also rewrites catalog facts,
 * and for a series its seasons, episodes, catalog state and numbering, which
 * must not happen to a title nobody has declared anything about. So this pass
 * reads TMDB itself and writes only the poster, backdrop, synopsis and the
 * time they were observed: no version, no other row and no operation.
 *
 * The reads are bounded by the turn and made together, so one that hangs
 * delays nothing but itself. A root TMDB does not answer for is left waiting
 * and is tried again on a later turn; see `artworkRootBackfillTurn`.
 */
export async function observeUntargetedRootArtwork(
  context: Pick<MediaAutomationContext, "db" | "tmdb">,
  period: number,
): Promise<void> {
  const count = await context.db.mediaItem.count({ where: waiting });
  const roots: WaitingRoot[] = [];
  for (const { skip, take } of artworkRootBackfillTurn(count, period))
    roots.push(
      ...(await context.db.mediaItem.findMany({
        where: waiting,
        orderBy: { id: "asc" },
        skip,
        take,
        select: { id: true, kind: true, tmdbId: true },
      })),
    );
  const observations = await Promise.all(
    roots.map(async (root) => ({
      root,
      artwork: await readArtwork(context, root),
    })),
  );
  for (const { root, artwork } of observations) {
    if (artwork === null) continue;
    await serializable(context.db, async (tx) => {
      await lockCanonicalMedia(tx, [root.id]);
      const current = await tx.mediaItem.findUniqueOrThrow({
        where: { id: root.id },
        select: { tmdbId: true, artworkObservedAt: true },
      });
      // Adopted or re-identified since the turn was read: the catalog write
      // that did it owns this root's artwork now.
      if (current.tmdbId !== root.tmdbId || current.artworkObservedAt !== null)
        return;
      await persistCatalogArtwork(tx, root.id, artwork, new Date());
    });
  }
}

/**
 * TMDB being unavailable, no longer having the title, or sending a body Media
 * cannot read are all expected at this boundary and leave the root waiting.
 * Anything else is a broken contract and fails the sweep.
 */
async function readArtwork(
  context: Pick<MediaAutomationContext, "tmdb">,
  root: WaitingRoot,
): Promise<CatalogArtwork | null> {
  if (root.tmdbId === null)
    throw new Error("Artwork backfill read a root without a TMDB identity");
  try {
    const details =
      root.kind === "movie"
        ? await context.tmdb.movie(root.tmdbId)
        : await context.tmdb.series(root.tmdbId);
    if (details.id !== root.tmdbId)
      throw new IntegrationError("tmdb", "invalid-response");
    return catalogArtwork(details);
  } catch (error) {
    if (error instanceof IntegrationError && error.service === "tmdb")
      return null;
    throw error;
  }
}
