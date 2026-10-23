import {
  Link,
  Outlet,
  createRootRouteWithContext,
  useRouter,
} from "@tanstack/react-router";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { queries } from "#client/queries.ts";
import { useFeedStatus, type ChangeFeed } from "#client/change-feed.ts";
import { PageHeader } from "#client/components/page-header.tsx";
import { errorMessage } from "#client/components/notices.tsx";
import { DeliveryClientError } from "#shared/client.ts";
import { awaitsDecision } from "#client/model/view.ts";

export type RouterContext = { queryClient: QueryClient; feed: ChangeFeed };

const NAVIGATION = [
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
            >
              {item.label}
              {item.to === "/approvals" && count > 0 && (
                <span className="nav-count">
                  <span className="visually-hidden">, </span>
                  {count}
                  <span className="visually-hidden"> waiting</span>
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
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="masthead">
        <Link to="/pipelines" className="brand">
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
      <main id="main">
        <Outlet />
      </main>
    </div>
  );
}

export function NotFound() {
  return (
    <>
      <PageHeader title="Not found" />
      <p>
        Nothing lives at this address.{" "}
        <Link to="/pipelines">Return to pipelines</Link>.
      </p>
    </>
  );
}

export function RouteError({ error }: { error: Error }) {
  const router = useRouter();
  if (error instanceof DeliveryClientError && error.status === 404)
    return <NotFound />;
  return (
    <>
      <PageHeader title="Something went wrong" />
      <div className="notice error" role="alert">
        {errorMessage(error)}
      </div>
      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          void router.invalidate();
        }}
      >
        Try again
      </button>
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
