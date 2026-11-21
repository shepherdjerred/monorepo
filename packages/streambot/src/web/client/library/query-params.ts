/**
 * Filters and paging live in the address bar so Back works and a page can be linked. A change to
 * any filter starts again at the first page; a change that names `offset` keeps it.
 */
export function applyChanges(
  current: URLSearchParams,
  changes: Readonly<Record<string, string>>,
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (!("offset" in changes)) next.delete("offset");
  for (const [key, value] of Object.entries(changes)) {
    if (value === "") next.delete(key);
    else next.set(key, value);
  }
  return next;
}

/** The `offset` in the address, or 0 when it is missing or not a plain number. */
export function readOffset(params: URLSearchParams): number {
  const value = params.get("offset");
  return value !== null && /^\d{1,7}$/u.test(value) ? Number(value) : 0;
}
