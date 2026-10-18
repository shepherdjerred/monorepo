import { createRouter } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { ChangeFeed } from "./change-feed.ts";
import { Route as rootRoute } from "./routes/root.tsx";
import { Route as hubRoute } from "./routes/hub.tsx";
import { serviceTree } from "./routes/service.tsx";
import { Route as buildRoute } from "./routes/build.tsx";
import { Route as versionRoute } from "./routes/version.tsx";
import { Route as deploymentRoute } from "./routes/deployment.tsx";
import { Route as environmentRoute } from "./routes/environment.tsx";
import { listRoutes } from "./routes/lists.tsx";

const routeTree = rootRoute.addChildren([
  hubRoute,
  serviceTree,
  buildRoute,
  versionRoute,
  deploymentRoute,
  environmentRoute,
  ...listRoutes,
]);

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
    scrollRestoration: true,
  });
  let initial = true;
  router.subscribe("onResolved", (event) => {
    if (initial) {
      initial = false;
      return;
    }
    if (!event.pathChanged) return;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("#main-heading")?.focus();
    });
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
