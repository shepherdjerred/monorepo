import {
  Link,
  Outlet,
  createRootRouteWithContext,
  useRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { ShellFrame } from "@shepherdjerred/console-ui";
import type { ChangeFeed } from "#client/change-feed.ts";
import { ConfirmDialogProvider } from "#client/components/confirm-dialog.tsx";
import { PageHeader } from "#client/components/page-header.tsx";
import { DeliverySidebar, Topbar } from "#client/shell/shell-nav.tsx";
import { DeliveryClientError } from "#shared/client.ts";

export type RouterContext = { queryClient: QueryClient; feed: ChangeFeed };

function RootLayout() {
  const { feed } = Route.useRouteContext();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Topbar feed={feed} />
      <ShellFrame sidebar={<DeliverySidebar feed={feed} />}>
        <main id="main" tabIndex={-1}>
          <ConfirmDialogProvider>
            <Outlet />
          </ConfirmDialogProvider>
        </main>
      </ShellFrame>
    </>
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
