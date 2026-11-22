import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";

/**
 * Renders `children` as the one route of a data router, as the application
 * does. A component that asks which view transition is running
 * (`ui/motion/title-transition.ts`) needs one: a plain `MemoryRouter` has no such
 * state.
 */
export function InRouter({
  children,
  address = "/",
  state = null,
}: {
  children: ReactNode;
  address?: string;
  /** What the link that led here put in the location's state. */
  state?: unknown;
}) {
  const router = createMemoryRouter([{ path: "*", element: children }], {
    initialEntries: [{ pathname: address, state }],
  });
  return <RouterProvider router={router} />;
}
