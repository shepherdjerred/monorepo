import { createRouter } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { ChangeFeed } from "./change-feed.ts";
import {
  NotFound,
  Pending,
  RouteError,
  Route as rootRoute,
} from "./routes/root.tsx";
import { Route as overviewRoute } from "./routes/overview.tsx";
import { pipelineListRoutes } from "./routes/pipelines.tsx";
import { commitRoutes } from "./routes/commits/commits.tsx";
import { serviceTree } from "./routes/service.tsx";
import { Route as buildRoute } from "./routes/build.tsx";
import { Route as versionRoute } from "./routes/version.tsx";
import { Route as deploymentRoute } from "./routes/deployment.tsx";
import { Route as environmentRoute } from "./routes/environment.tsx";
import { Route as recoveryIntentRoute } from "./routes/recovery-intent.tsx";
import { listRoutes } from "./routes/lists.tsx";
import { pagedOnly, syncSearchForms } from "./routes/search-schemas.ts";

const routeTree = rootRoute.addChildren([
  overviewRoute,
  ...pipelineListRoutes,
  ...commitRoutes,
  serviceTree,
  buildRoute,
  versionRoute,
  deploymentRoute,
  environmentRoute,
  recoveryIntentRoute,
  ...listRoutes,
]);

/**
 * Focus the first of these elements the page has. The new page is rendered
 * before the router reports it resolved, so focus moves at once, for a click
 * and for Enter on a link alike, and in a tab that runs no animation frames.
 * A frame later it only repeats the move when the element it focused has
 * since been replaced, so a reader who has tabbed on is never pulled back.
 */
function moveFocus(targets: readonly string[]) {
  for (const target of targets) {
    const element = document.querySelector<HTMLElement>(target);
    if (element === null) continue;
    element.focus();
    requestAnimationFrame(() => {
      if (!element.isConnected) moveFocus(targets);
    });
    return;
  }
}

export function createDeliveryRouter(
  queryClient: QueryClient,
  feed: ChangeFeed,
) {
  const router = createRouter({
    routeTree,
    context: { queryClient, feed },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 200,
    // A child route's failure, absence or wait renders inside the root
    // layout, so the header, navigation and main landmark stay.
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: NotFound,
    defaultPendingComponent: Pending,
    scrollRestoration: true,
  });
  let initial = true;
  router.subscribe("onResolved", (event) => {
    if (initial) {
      initial = false;
      return;
    }
    const previous = event.fromLocation?.search ?? {};
    // Synchronously, so a filter changed after this navigation is never
    // overwritten by a late frame.
    syncSearchForms(previous, event.toLocation.search);
    // A new page announces its heading; a new page of a list starts again
    // at the top of that list.
    const targets = event.pathChanged
      ? ["#main-heading"]
      : pagedOnly(previous, event.toLocation.search)
        ? ["#list-heading", "#main-heading"]
        : [];
    if (targets.length > 0) moveFocus(targets);
  });
  return router;
}

declare module "@tanstack/react-router" {
  // TanStack Router discovers the route tree through declaration merging,
  // which only works with an interface — a type alias cannot merge.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration merging requires `interface`
  interface Register {
    router: ReturnType<typeof createDeliveryRouter>;
  }
}
