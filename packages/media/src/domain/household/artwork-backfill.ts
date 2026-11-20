/**
 * How many titles one due page may queue for artwork alone. A kept or followed
 * title is refreshed regardless and never counts. Every refresh drains through
 * the shared first-in-first-out outbox, so this holds a first backfill to one
 * refresh for every five rows of a full page.
 */
export const ARTWORK_BACKFILL_PER_PAGE = 10;

/**
 * Chooses which of a due page's artwork-only candidates are refreshed this
 * six-hour period. `candidateSlots` are the candidates' row positions in the
 * page, which is always read in the same id order.
 *
 * The page is scanned as a ring from a start that advances by the budget each
 * period, and the first candidates met take the budget. A title whose refresh
 * keeps failing stays a candidate and is tried again on its turn, but it
 * cannot hold the budget: whatever else is on the page, a candidate is chosen
 * in the period whose start falls in its own stretch of rows, because at most
 * nine other candidates can lie between that start and it.
 *
 * So every candidate is tried at least once in any `pageSize / budget`
 * consecutive periods (five, 30 hours, for a 50-row page), for as long as its
 * row stays in the same stretch of the page. Ten or fewer candidates are all
 * tried every period.
 */
export function artworkBackfillTurn(
  candidateSlots: readonly number[],
  pageSize: number,
  period: number,
): number[] {
  const turns = Math.ceil(pageSize / ARTWORK_BACKFILL_PER_PAGE);
  const start = (period % turns) * ARTWORK_BACKFILL_PER_PAGE;
  const distance = (slot: number) => (slot - start + pageSize) % pageSize;
  return candidateSlots
    .toSorted((left, right) => distance(left) - distance(right))
    .slice(0, ARTWORK_BACKFILL_PER_PAGE);
}
