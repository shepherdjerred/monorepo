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

/**
 * How many roots without a default target one due sweep may ask TMDB about.
 * Each is one catalog read made by the sweep itself, never an outbox command.
 */
export const ARTWORK_ROOT_BACKFILL_PER_PERIOD = 25;

/**
 * Chooses which roots without a default target have their artwork observed
 * this six-hour period. `count` is how many are waiting; the result is the
 * stretches of that list to read, by position in id order.
 *
 * The waiting roots form a ring. The period's window starts at
 * `period * budget` modulo `count` and takes the budget, wrapping. Successive
 * windows therefore lie end to end, so while the waiting set stays the same
 * they cover the whole ring: every waiting root is tried at least once in any
 * `ceil(count / budget)` consecutive periods. Twenty-five or fewer are all
 * tried every period.
 *
 * That set changes only when a root is observed, which is the backfill making
 * progress, or when a root arrives or gains a target. A root TMDB keeps
 * failing for stays in the ring and is retried on its turn, but it cannot hold
 * the budget: the roots after it are reached by the same rotation. With fewer
 * failing roots than the budget, every window still observes at least
 * `budget - failing` roots, so a backfill of `count` roots ends within
 * `ceil((count - failing) / (budget - failing))` periods, which is
 * `ceil(count / budget)` when none fail. With more failing roots than that,
 * a window can be all failures, and the guarantee is the rotation's alone:
 * the set then stays the same, so within `ceil(count / budget)` periods the
 * windows reach a root TMDB can answer for, if one is waiting.
 */
export function artworkRootBackfillTurn(
  count: number,
  period: number,
): { skip: number; take: number }[] {
  if (count === 0) return [];
  const take = Math.min(count, ARTWORK_ROOT_BACKFILL_PER_PERIOD);
  const start = (period * ARTWORK_ROOT_BACKFILL_PER_PERIOD) % count;
  const first = Math.min(take, count - start);
  return first === take
    ? [{ skip: start, take }]
    : [
        { skip: start, take: first },
        { skip: 0, take: take - first },
      ];
}
