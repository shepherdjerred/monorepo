import { createRouter } from "@tanstack/react-router";
import * as Sentry from "@sentry/react";
import { rootRoute } from "./routes/root.tsx";
import { searchRoute } from "./routes/search.tsx";
import { courseRoute } from "./routes/course.tsx";

const routeTree = rootRoute.addChildren([searchRoute, courseRoute]);

export const router = createRouter({
  routeTree,
  scrollRestoration: true,
  defaultOnCatch: (error) => {
    Sentry.captureException(error);
  },
});

declare module "@tanstack/react-router" {
  // TanStack Router discovers the app's route tree through declaration
  // merging, which only works with an interface — a type alias cannot merge.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration merging requires `interface`
  interface Register {
    router: typeof router;
  }
}
