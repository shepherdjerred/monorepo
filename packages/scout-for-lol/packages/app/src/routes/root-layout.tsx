import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { Outlet, useLocation } from "react-router";
import {
  ContractMismatchBanner,
  VersionFooter,
} from "#src/components/version-info.tsx";
import {
  analyticsContextRoute,
  normalizePath,
  resolvedAnalyticsContextRoute,
  startAnalyticsCapture,
  stopAnalyticsCapture,
  subscribeAnalyticsContext,
  trackPageview,
} from "#src/lib/analytics.ts";
import { useAnalyticsIdentity } from "#src/hooks/use-analytics-identity.ts";
import { FeedbackPrompt } from "#src/components/feedback-prompt.tsx";

/**
 * Top-level chrome shared by every route (login included): the contract
 * mismatch banner above the routed content and the build-identity footer below
 * it. Mirrors the old `App` wrapper — the routed page renders through the
 * {@link Outlet}.
 */
export function RootLayout() {
  const location = useLocation();

  // Identity is synced here, not in `RequireSession`, because `/login` is
  // mounted outside that guard — see the hook for why that matters.
  const { sessionResolved } = useAnalyticsIdentity();

  // PostHog is initialised opted out, and this is the one place that opens it.
  // Nothing — pageview or autocapture — may leave the browser until the session
  // has answered and the route's own context is attached, because PostHog
  // cannot reattribute an event after the fact.
  const requiredContextRoute = analyticsContextRoute(location.pathname);
  const settledContextRoute = useSyncExternalStore(
    subscribeAnalyticsContext,
    resolvedAnalyticsContextRoute,
  );
  const ready =
    sessionResolved &&
    (requiredContextRoute === undefined ||
      requiredContextRoute === settledContextRoute);

  // Close before the browser can deliver mutation/replay observations for a
  // newly rendered unresolved route. Opening stays in the passive effect below
  // so the identity reconciliation effect always runs first.
  useLayoutEffect(() => {
    if (!ready) stopAnalyticsCapture();
  }, [ready]);

  // Report a templated pageview on initial load and every client-side
  // navigation. Dynamic segments collapse to route shapes so analytics never
  // receives guild, report, competition, or player identifiers.
  useEffect(() => {
    if (!ready) return;
    startAnalyticsCapture();
    trackPageview(normalizePath(location.pathname));
  }, [ready, location.pathname]);

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
