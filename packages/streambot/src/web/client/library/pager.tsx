import { Link } from "react-router";
import { pageRange } from "./paging.ts";
import "@shepherdjerred/streambot/web/client/styles/browse.css";

/**
 * Previous and Next links for a paged list, with where the viewer is in it. Links rather than
 * buttons, so each page has an address. Renders nothing when everything fits on one page.
 */
export function Pager(props: {
  label: string;
  offset: number;
  total: number;
  size: number;
  hrefFor: (offset: number) => string;
}) {
  if (props.total <= props.size) return null;
  const range = pageRange(props.offset, props.total, props.size);
  return (
    <nav className="pager" aria-label={props.label}>
      {range.previous === null ? (
        <span className="pager-off">Previous</span>
      ) : (
        <Link className="btn" to={props.hrefFor(range.previous)}>
          Previous
        </Link>
      )}
      <span className="muted numeric">
        {range.first}–{range.last} of {props.total}
      </span>
      {range.next === null ? (
        <span className="pager-off">Next</span>
      ) : (
        <Link className="btn" to={props.hrefFor(range.next)}>
          Next
        </Link>
      )}
    </nav>
  );
}
