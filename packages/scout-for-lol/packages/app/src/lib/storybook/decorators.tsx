import type { Decorator } from "@storybook/react-vite";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { z } from "zod";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlockDefaults } from "@shepherdjerred/loaded/react.tsx";
import {
  ErrorState,
  LoadingState,
} from "@scout-for-lol/design-system/domain/states";
import { ScoutThemeProvider } from "@scout-for-lol/design-system/runtime";
import {
  resolveScoutThemeGlobals,
  seedScoutThemePreference,
} from "@scout-for-lol/design-system/storybook/preview";
import { TRPCProvider } from "#src/lib/query/trpc.ts";
import {
  createStoryQueryClient,
  storyTrpcClient,
  type StorySeed,
} from "#src/lib/storybook/trpc-stub.ts";

const SeedsSchema = z.array(
  z.custom<StorySeed>((value) => typeof value === "function"),
);
const EntriesSchema = z.array(z.string()).min(1);

/**
 * Seeds the stored preference the provider boots from, then remounts the
 * provider through `key` so a toolbar change re-reads it the way a page load
 * would. The globals only seed: a story that changes the theme from inside
 * keeps that change.
 */
export const withScoutTheme: Decorator = (story, context) => {
  const theme = resolveScoutThemeGlobals(context.globals);
  seedScoutThemePreference(theme);
  return (
    <ScoutThemeProvider key={`${theme.skin}-${theme.mode}`} surface="app">
      {story()}
    </ScoutThemeProvider>
  );
};

/**
 * The SPA's data and loading context, minus the router: a QueryClient primed
 * from `parameters.seedQueries`, the tRPC provider over the hanging transport,
 * and the same loading and error defaults main.tsx installs.
 *
 * A fresh QueryClient per story keeps one story's seeded data from leaking
 * into the next.
 */
export const withAppProviders: Decorator = (story, context) => {
  const parsedSeeds = SeedsSchema.safeParse(context.parameters["seedQueries"]);
  const queryClient = createStoryQueryClient(
    parsedSeeds.success ? parsedSeeds.data : [],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={storyTrpcClient} queryClient={queryClient}>
        <LoadingBlockDefaults
          fallback={<LoadingState />}
          renderError={(errors) => (
            <ErrorState message={Loaded.messageOf(errors[0].error)} />
          )}
        >
          {story()}
        </LoadingBlockDefaults>
      </TRPCProvider>
    </QueryClientProvider>
  );
};

/**
 * A minimal external store holding the latest route element, so a subscriber
 * can pick up a new value without the router that reads it being rebuilt.
 */
function createChildrenStore(initial: ReactNode) {
  let current = initial;
  const listeners = new Set<() => void>();
  // Arrow-function properties, not method shorthand: `useSyncExternalStore`
  // takes `get`/`subscribe` unbound, and a method-shorthand property trips
  // `@typescript-eslint/unbound-method` when read that way even though
  // neither ever touches `this`.
  const get = (): ReactNode => current;
  const set = (next: ReactNode): void => {
    current = next;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { get, set, subscribe };
}

/** Renders whatever `store` currently holds, re-rendering when it changes. */
function StoryRouteOutlet(props: {
  store: ReturnType<typeof createChildrenStore>;
}) {
  const children = useSyncExternalStore(props.store.subscribe, props.store.get);
  return <>{children}</>;
}

/**
 * `Link`, `NavLink`, `useNavigate` and `useLocation` need a router above them.
 *
 * This is a *data* router, matching the `createBrowserRouter` the app boots
 * with. The distinction is load-bearing: `useBlocker` — which the report and
 * competition forms call to guard unsaved edits — throws outright under the
 * non-data `MemoryRouter`.
 *
 * A story that builds its own router, as the route error panel does for its
 * `errorElement`, opts out with `parameters.router: "none"`; nesting routers
 * throws.
 */
function StoryRouter(props: { entries: string[]; children: ReactNode }) {
  const { entries, children } = props;
  // The store, not the router, holds the current route element. Editing
  // Storybook's controls re-invokes this component with new `children` on
  // every render, and the store's `set` below re-renders `StoryRouteOutlet`
  // to match — without touching the router itself. `useRef`'s initializer
  // runs on every render, but only the first call's store is kept.
  const store = useRef(createChildrenStore(children)).current;
  useEffect(() => {
    store.set(children);
  }, [children, store]);

  // Built once per mount. `createMemoryRouter` returns a new router instance
  // every call, and handing RouterProvider a new instance remounts everything
  // under it, discarding in-story navigation on every arg change. The route
  // element is `StoryRouteOutlet`, which reads the current children from the
  // store above rather than the snapshot captured here.
  const [router] = useState(() =>
    createMemoryRouter(
      [{ path: "*", element: <StoryRouteOutlet store={store} /> }],
      { initialEntries: entries },
    ),
  );
  return <RouterProvider router={router} />;
}

export const withRouter: Decorator = (story, context) => {
  if (context.parameters["router"] === "none") return story();
  const parsedEntries = EntriesSchema.safeParse(
    context.parameters["routerEntries"],
  );
  const entries = parsedEntries.success ? parsedEntries.data : ["/"];
  return <StoryRouter entries={entries}>{story()}</StoryRouter>;
};
