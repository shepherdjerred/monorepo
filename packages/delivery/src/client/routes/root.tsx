import {
  Link,
  Outlet,
  createRootRouteWithContext,
  useRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { queries } from "#client/queries.ts";
import { useFeedStatus, type ChangeFeed } from "#client/change-feed.ts";
import { ConfirmDialogProvider } from "#client/components/confirm-dialog.tsx";
import { PageHeader } from "#client/components/page-header.tsx";
import { DeliveryClientError } from "#shared/client.ts";
import { awaitsDecision } from "#client/model/view.ts";

export type RouterContext = { queryClient: QueryClient; feed: ChangeFeed };

const NAVIGATION = [
  { to: "/", label: "Overview", exact: true },
  { to: "/commits", label: "Commits", exact: false },
  { to: "/pipelines", label: "Pipelines", exact: false },
  { to: "/deployments", label: "Deployments", exact: false },
  { to: "/approvals", label: "Approvals", exact: false },
  { to: "/artifacts", label: "Artifacts", exact: false },
  { to: "/activity", label: "Activity", exact: false },
] as const;

function FeedIndicator({ feed }: { feed: ChangeFeed }) {
  const status = useFeedStatus(feed);
  const label = {
    connecting: "Connecting…",
    live: "Live",
    reconnecting: "Reconnecting…",
  }[status];
  return (
    <p className={`feed feed-${status}`} role="status">
      <span className="dot" aria-hidden="true" />
      {label}
    </p>
  );
}

function Navigation() {
  const approvals = useQuery(queries.approvals());
  const count =
    approvals.data?.filter((item) => awaitsDecision(item)).length ?? 0;
  return (
    <nav aria-label="Main">
      <ul>
        {NAVIGATION.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              activeOptions={{ exact: item.exact, includeSearch: false }}
              // One name, spoken as written: separate hidden spans would each
              // be set apart by a space ("Approvals , 1").
              aria-label={
                item.to === "/approvals" && count > 0
                  ? `${item.label}, ${String(count)} awaiting approval`
                  : undefined
              }
            >
              {item.label}
              {item.to === "/approvals" && count > 0 && " "}
              {item.to === "/approvals" && count > 0 && (
                <span className="nav-count" aria-hidden="true">
                  {count}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Identity() {
  const identity = useQuery(queries.identity());
  return (
    <p className="identity">
      {identity.data === undefined
        ? identity.error === null
          ? "Checking identity…"
          : "Authentication required"
        : identity.data.id}
    </p>
  );
}

function RootLayout() {
  const { feed } = Route.useRouteContext();
  return (
    <div>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="masthead">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⟶
          </span>
          Delivery
        </Link>
        <Navigation />
        <div className="masthead-end">
          <FeedIndicator feed={feed} />
          <Identity />
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <ConfirmDialogProvider>
          <Outlet />
        </ConfirmDialogProvider>
      </main>
    </div>
  );
}

export function NotFound() {
  return (
    <>
      <PageHeader title="Not found" takeFocus />
      <p>
        Nothing lives at this address.{" "}
        <Link to="/">Return to the overview</Link>.
      </p>
    </>
  );
}

/** The server's words for a failure, or a plain fallback when it gave none. */
function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message === "" ? "Delivery could not load this page." : message;
}

/** A request the server refused as asked; asking again cannot change that. */
function refused(error: unknown) {
  return (
    error instanceof DeliveryClientError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

/**
 * A route that failed to load, inside the app's own layout, in the server's
 * words without its machine code. A request the server refused offers a way
 * out; anything else may pass on a retry.
 */
export function RouteError({
  error,
  recovery,
}: {
  error: unknown;
  recovery?: ReactNode;
}) {
  const router = useRouter();
  if (error instanceof DeliveryClientError && error.status === 404)
    return <NotFound />;
  const final = refused(error);
  return (
    <>
      <PageHeader
        title={final ? "This page cannot be shown" : "Something went wrong"}
        takeFocus
      />
      <div className="notice error" role="alert">
        {errorText(error)}
      </div>
      <p>
        {final ? (
          (recovery ?? <Link to="/">Return to the overview</Link>)
        ) : (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              void router.invalidate();
            }}
          >
            Try again
          </button>
        )}
      </p>
    </>
  );
}

export function Pending() {
  return (
    <p className="pending" role="status">
      Loading…
    </p>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
  pendingComponent: Pending,
});
