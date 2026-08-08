import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import {
  ContractMismatchBanner,
  VersionFooter,
} from "#src/components/version-info.tsx";
import { normalizePath, trackPageview } from "#src/lib/analytics.ts";
import { FeedbackPrompt } from "#src/components/feedback-prompt.tsx";

/**
 * Top-level chrome shared by every route (login included): the contract
 * mismatch banner above the routed content and the build-identity footer below
 * it. Mirrors the old `App` wrapper — the routed page renders through the
 * {@link Outlet}.
 */
export function RootLayout() {
  const location = useLocation();

  // Report a templated pageview on initial load and every client-side
  // navigation. Dynamic segments collapse to route shapes so analytics never
  // receives guild, report, competition, or player identifiers.
  useEffect(() => {
    trackPageview(normalizePath(location.pathname));
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <ContractMismatchBanner />
      <FeedbackPrompt />
      <div className="flex-1">
        <Outlet />
      </div>
      <VersionFooter />
    </div>
  );
}
