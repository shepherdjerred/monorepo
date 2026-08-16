import React from "react";
import { Outlet, createRootRoute, useRouter } from "@tanstack/react-router";
import { Footer } from "#src/components/layout/footer";
import { Button } from "#components/ui/button";

function RootLayout(): React.ReactElement {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1">
        <Outlet />
      </div>
      <Footer />
    </div>
  );
}

export function NotFound(): React.ReactElement {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Page Not Found</h1>
      <p className="text-muted-foreground">This page doesn&apos;t exist.</p>
    </div>
  );
}

// Sentry reporting happens in the router-level defaultOnCatch
// (src/router.tsx); this component only renders the failure state.
function RootError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): React.ReactElement {
  const router = useRouter();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-4xl font-bold tracking-tight">
        Something went wrong
      </h1>
      <p className="max-w-prose text-muted-foreground">{error.message}</p>
      <Button
        onClick={() => {
          reset();
          void router.invalidate();
        }}
      >
        Try again
      </Button>
    </div>
  );
}

export const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RootError,
});
