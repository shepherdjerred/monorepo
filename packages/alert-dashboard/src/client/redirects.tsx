import { Navigate, useLocation } from "react-router";

/** Sends an old URL to its new path with the query string and fragment intact. */
function RedirectTo({
  pathname,
}: {
  readonly pathname: string;
}): React.JSX.Element {
  const { search, hash } = useLocation();
  return <Navigate replace to={{ pathname, search, hash }} />;
}

/**
 * `/overview` was a page of its own before Home absorbed it. Bookmarks and
 * old links land on Home.
 */
export function OverviewRedirect(): React.JSX.Element {
  return <RedirectTo pathname="/" />;
}

/**
 * The Flow page lived at `/delivery`, the name of a different app. Bookmarks
 * and old links land on `/flow`.
 */
export function DeliveryRedirect(): React.JSX.Element {
  return <RedirectTo pathname="/flow" />;
}
