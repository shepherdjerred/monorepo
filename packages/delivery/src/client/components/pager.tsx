import { Link } from "@tanstack/react-router";

/**
 * Keyset paging for a newest-first list: "Older" follows the page's cursor and
 * "Newest" drops it. Every other search parameter is kept, so a filter
 * survives paging.
 */
export function OlderLink({
  to,
  search,
  cursor,
}: {
  to: "/commits" | "/deployments" | "/artifacts" | "/activity";
  search: Record<string, string | undefined>;
  cursor: string | null;
}) {
  return (
    <nav aria-label="Pages" className="pager">
      {search["cursor"] !== undefined && (
        <Link to={to} search={{ ...search, cursor: undefined }}>
          Newest
        </Link>
      )}
      {cursor !== null && (
        <Link to={to} search={{ ...search, cursor }}>
          Older
        </Link>
      )}
    </nav>
  );
}
