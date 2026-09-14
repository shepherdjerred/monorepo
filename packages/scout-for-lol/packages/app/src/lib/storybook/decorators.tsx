import type { Decorator } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
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
  // Built once per mount. `createMemoryRouter` returns a new router instance
  // every call, and handing RouterProvider a new instance remounts everything
  // under it — so building it during render would reset the story on every
  // render. Storybook remounts the decorator when the story changes, which is
  // when a fresh router is actually wanted.
  const [router] = useState(() =>
    createMemoryRouter([{ path: "*", element: children }], {
      initialEntries: entries,
    }),
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
