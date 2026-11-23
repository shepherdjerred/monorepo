// Small phrasing helpers the commit sentences share.

/** "1 service", "2 services". */
export const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

/** "a", "a and b", "a, b and c". */
export function series(items: readonly string[]) {
  const last = items.at(-1) ?? "";
  return items.length <= 1
    ? last
    : `${items.slice(0, -1).join(", ")} and ${last}`;
}

/** Up to three items in a series, then how many more: "a, b, c and 2 more". */
export function capped(items: readonly string[], limit = 3) {
  return items.length <= limit
    ? series(items)
    : `${items.slice(0, limit).join(", ")} and ${String(items.length - limit)} more`;
}

/** Each distinct value once, in first-seen order. */
export const distinct = (items: readonly string[]) => [...new Set(items)];
