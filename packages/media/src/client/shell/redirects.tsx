import type { ReactNode } from "react";
import {
  generatePath,
  Navigate,
  Outlet,
  useLocation,
  useParams,
} from "react-router";
import { useUser } from "./user.ts";

/** Where anything a person cannot open, or that no longer exists, lands. */
export const HOME_PATH = "/";

/**
 * Sends an address that moved to its new home. Emails, Discord messages,
 * OAuth returns, and bookmarks carry the old addresses, so the path
 * parameters, query string, and fragment travel with the redirect.
 *
 * `ownerOnly` targets are in Manage: a member goes home directly instead of
 * through a page they cannot open.
 */
export function MovedTo({
  path,
  ownerOnly = false,
}: {
  path: string;
  ownerOnly?: boolean;
}) {
  const user = useUser();
  const params = useParams();
  const { search, hash } = useLocation();
  if (ownerOnly && user.role !== "owner") {
    return <Navigate to={HOME_PATH} replace />;
  }
  return (
    <Navigate
      to={{ pathname: generatePath(path, params), search, hash }}
      replace
    />
  );
}

/**
 * An address a member still uses where it is, and the owner works from
 * Manage: the owner is sent to `path`, a member is shown `children`.
 */
export function MovedForOwner({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  const user = useUser();
  return user.role === "owner" ? <MovedTo path={path} /> : children;
}

/** Renders the routes beneath it for the owner; sends anyone else home. */
export function OwnerOnly() {
  const user = useUser();
  return user.role === "owner" ? (
    <Outlet />
  ) : (
    <Navigate to={HOME_PATH} replace />
  );
}
