import { createContext, useContext } from "react";
import { z } from "zod";
import {
  useLocation,
  useResolvedPath,
  useViewTransitionState,
  type To,
} from "react-router";
import { useMediaQuery } from "#client/ui/use-media-query.ts";

/**
 * Where on a page a list of titles sits: its label. Two lists can hold the
 * same title (one both trending and new), and only the card the reader opened
 * may carry the transition name, so a card is told apart by its list as well
 * as by its title.
 */
export const PosterPlace = createContext("");

/**
 * What a card tells the title page it opens, in the link's state: its
 * poster, so the page can show it from the first frame while the title is
 * still being read. The transition carries the poster to wherever the page
 * has one at that moment, and a skeleton block would be a poster-shaped
 * hole.
 */
const OpenedPosterSchema = z.object({
  openedPoster: z.object({ path: z.string().nullable(), title: z.string() }),
});

export type OpenedPoster = z.infer<typeof OpenedPosterSchema>["openedPoster"];

/** The poster of the card the reader came from, if they came from one. */
export function useOpenedPoster(): OpenedPoster | null {
  const parsed = OpenedPosterSchema.safeParse(useLocation().state);
  return parsed.success ? parsed.data.openedPoster : null;
}

/**
 * The card opened from each history entry, by the router's key for the entry:
 * where the card is and which title it opens. Every entry keeps its own, so
 * going back through several title visits finds each list's own card, not
 * the last one clicked anywhere. The router says which pages a transition
 * moves between and nothing about which card, which is why this is kept.
 */
const openedFrom = new Map<string, string>();

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Whether the poster may move from a card to the title page and back. A
 * browser without view transitions (they are Baseline newly available) still
 * opens the title, instantly, and a reader who asked for less motion gets no
 * motion.
 */
function useMayMove(): boolean {
  const reduced = useMediaQuery(REDUCED_MOTION);
  // Rendered without a page (a test's `renderToString`), there is no document.
  const exists =
    "document" in globalThis && "startViewTransition" in globalThis.document;
  return !reduced && exists;
}

/**
 * What a link from a poster to a title page needs to carry the poster
 * across: `link`, props for the link itself, and `carries` for the poster,
 * true only on the card the reader opened from this history entry and only
 * while the transition runs. The browser takes the one element with the
 * transition's name from each page, so a second card with the name would end
 * the transition before it began.
 *
 * Going back to the list the transition is the router's own (it remembers
 * which pages it moved between), and the card that carries the name is the
 * one remembered for the entry being returned to.
 *
 * `place` names a card that has no list around it (a release in the
 * calendar) among the cards of its page.
 */
export function useOpensTitle(to: To, poster: OpenedPoster, place?: string) {
  const listed = useContext(PosterPlace);
  const may = useMayMove();
  const entry = useLocation().key;
  const key = `${place ?? listed}\n${useResolvedPath(to).pathname}`;
  const underway = useViewTransitionState(to);
  return {
    carries: may && underway && openedFrom.get(entry) === key,
    link: {
      viewTransition: may,
      state: { openedPoster: poster },
      onClick: () => {
        openedFrom.set(entry, key);
      },
    },
  };
}

/**
 * Whether the title page's poster carries the name: while a transition runs
 * between this page and another. The page has one poster, so it is never
 * ambiguous.
 */
export function useHeroPosterCarries(): boolean {
  const may = useMayMove();
  const underway = useViewTransitionState(useLocation().pathname);
  return may && underway;
}
