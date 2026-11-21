/** The server returns 50 titles, entries or plays per request. */
export const PAGE_SIZE = 50;

export type PageRange = {
  /** 1-based position of the first item shown; 0 when there are none. */
  readonly first: number;
  readonly last: number;
  readonly previous: number | null;
  readonly next: number | null;
};

/** Which items a page shows, and the offsets of its neighbours (`null` where there is none). */
export function pageRange(
  offset: number,
  total: number,
  size: number = PAGE_SIZE,
): PageRange {
  if (total === 0) return { first: 0, last: 0, previous: null, next: null };
  // An offset past the end (a stale link) still offers a way back to the last page.
  const lastStart = Math.floor((total - 1) / size) * size;
  const start = Math.min(offset, lastStart);
  const last = Math.min(start + size, total);
  let previous: number | null = null;
  if (offset > lastStart) previous = lastStart;
  else if (start > 0) previous = start - size;
  return {
    first: start + 1,
    last,
    previous,
    next: last >= total ? null : start + size,
  };
}
