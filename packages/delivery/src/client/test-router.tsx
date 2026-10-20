import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";

/** Static markup of a component that renders router links. */
export function renderWithRouter(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory(),
  });
  return renderToStaticMarkup(
    <RouterContextProvider router={router}>{node}</RouterContextProvider>,
  );
}
