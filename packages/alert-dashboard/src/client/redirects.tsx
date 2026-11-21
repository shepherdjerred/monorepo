import { Navigate, useLocation } from "react-router";

/**
 * `/overview` was a page of its own before Home absorbed it. Bookmarks and
 * old links land on Home with their query string and fragment intact.
 */
export function OverviewRedirect(): React.JSX.Element {
  const { search, hash } = useLocation();
  return <Navigate replace to={{ pathname: "/", search, hash }} />;
}
