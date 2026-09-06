import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { Outlet, useLocation } from "react-router";
import {
  AppHeader,
  AppWorkspaceFrame,
  GlobalFooter,
} from "@scout-for-lol/design-system/layout";
import { ContractMismatchBanner } from "#src/components/version-info.tsx";
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
import { UserMenu } from "#src/components/user-menu.tsx";
import { buildInfo } from "#src/lib/build-info.ts";
import {
  docsOrigin,
  marketingOrigin,
} from "#src/lib/analytics/surface-origins.ts";
import { AppNavigation } from "#src/components/app-navigation.tsx";
import {
  resolveAppShellMode,
  shouldRenderGlobalFooter,
} from "#src/lib/app-navigation.ts";
import { ExploreRunsProvider } from "#src/components/explore/explore-runs-provider.tsx";

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
  const { sessionResolved, username } = useAnalyticsIdentity();
  const shellMode = resolveAppShellMode(
    location.pathname,
    username !== undefined,
  );
  const navigation = shellMode === "workspace" ? <AppNavigation /> : undefined;

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

  // Disable viewport overscroll / rubber-banding and snapping on Explore
  // routes so gestures scroll the conversation cleanly without bouncing the window.
  useEffect(() => {
    const isExplore = !shouldRenderGlobalFooter(location.pathname);
    if (!isExplore) return;
    const root = document.documentElement;
    const body = document.body;
    const previousRoot = root.style.overscrollBehavior;
    const previousBody = body.style.overscrollBehavior;
    root.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    return () => {
      root.style.overscrollBehavior = previousRoot;
      body.style.overscrollBehavior = previousBody;
    };
  }, [location.pathname]);

  return (
    <ExploreRunsProvider>
      <AppWorkspaceFrame
        header={
          <AppHeader
            accountMenu={
              username === undefined ? undefined : (
                <UserMenu username={username} />
              )
            }
            mobileNavigation={navigation}
            origins={{ marketing: marketingOrigin, docs: docsOrigin }}
          />
        }
        notice={
          <>
            <ContractMismatchBanner />
            <FeedbackPrompt />
          </>
        }
        sidebar={navigation}
        footer={
          shouldRenderGlobalFooter(location.pathname) ? (
            <GlobalFooter
              release={buildInfo.version}
              commit={buildInfo.gitSha}
              origins={{ marketing: marketingOrigin, docs: docsOrigin }}
            />
          ) : undefined
        }
      >
        <Outlet />
      </AppWorkspaceFrame>
    </ExploreRunsProvider>
  );
}
