import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ErrorPanel, RouteErrorPanel } from "./route-error-panel.tsx";

/** Stories have no backend, so every handler is deliberately inert. */
function noop(): void {
  // Intentionally empty.
}

/**
 * `RouteErrorPanel` is a data-router `errorElement`: it reads the caught error
 * through `useRouteError`, so it only renders under a router whose route
 * actually threw. These stories opt out of the global `MemoryRouter`
 * (`parameters.router: "none"` — nesting routers throws) and build their own
 * `createMemoryRouter` with a loader that fails.
 */
function errorRouter(thrown: unknown) {
  return createMemoryRouter(
    [
      {
        path: "/reports/12",
        loader: () => {
          throw thrown;
        },
        element: <p>This element never renders — the loader throws first.</p>,
        errorElement: <RouteErrorPanel />,
      },
    ],
    { initialEntries: ["/reports/12"] },
  );
}

const UNEXPECTED_ROUTER = errorRouter(
  new Error("Timed out reading the report lake"),
);
const NOT_FOUND_ROUTER = errorRouter(
  new Response(null, { status: 404, statusText: "Not Found" }),
);

const meta = {
  title: "Chrome/RouteErrorPanel",
  component: RouteErrorPanel,
  tags: ["autodocs"],
} satisfies Meta<typeof RouteErrorPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const UnexpectedError: Story = {
  parameters: { router: "none" },
  render: () => <RouterProvider router={UNEXPECTED_ROUTER} />,
};

export const NotFoundResponse: Story = {
  parameters: { router: "none" },
  render: () => <RouterProvider router={NOT_FOUND_ROUTER} />,
};

export const PanelWithDetail: Story = {
  render: () => (
    <ErrorPanel
      title="This conversation couldn't load"
      message="Couldn't reach Discord, try again in a moment."
      detail="Network timeout after 10s"
    />
  ),
};

export const PanelWithRetry: Story = {
  render: () => (
    <ErrorPanel
      title="Explore couldn't load"
      message="Scout could not confirm your access to this guild."
      onRetry={noop}
      retryLabel="Retry access"
      action={
        <a
          className="text-sm underline underline-offset-4"
          href="https://scout-for-lol.com/app/explore"
        >
          Start a new conversation
        </a>
      }
    />
  ),
};

export const PanelMinimal: Story = {
  render: () => <ErrorPanel />,
};
