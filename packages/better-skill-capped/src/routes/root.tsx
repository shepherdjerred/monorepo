import React from "react";
import { Outlet, createRootRoute, useRouter } from "@tanstack/react-router";
import { Footer } from "#src/components/footer";
import { Color, Hero, Size } from "#src/components/hero";
import "#styles/wrapper.css";

function RootLayout(): React.ReactElement {
  return (
    <div className="page-wrapper">
      <div className="content-wrapper">
        <Outlet />
      </div>
      <Footer />
    </div>
  );
}

export function NotFound(): React.ReactElement {
  return (
    <Hero
      title="Page Not Found"
      subtitle="This page doesn't exist"
      size={Size.FULL}
      color={Color.RED}
    />
  );
}

// Sentry reporting happens in the router-level onCatch (src/router.tsx);
// this component only renders the failure state.
function RootError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): React.ReactElement {
  const router = useRouter();

  return (
    <section className="hero is-danger is-fullheight">
      <div className="hero-body">
        <div>
          <p className="title">Something went wrong</p>
          <p className="subtitle">{error.message}</p>
          <button
            className="button"
            onClick={() => {
              reset();
              void router.invalidate();
            }}
          >
            Try again
          </button>
        </div>
      </div>
    </section>
  );
}

export const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RootError,
});
