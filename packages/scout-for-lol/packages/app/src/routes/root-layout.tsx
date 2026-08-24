import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { Outlet, useLocation } from "react-router";
import {
  GlobalFooter,
  GlobalNavbar,
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

function localSurfaceOrigin(
  configured: unknown,
  developmentFallback: string,
): string | undefined {
  if (typeof configured === "string" && configured.length > 0) {
    return configured;
  }
  return import.meta.env.DEV ? developmentFallback : undefined;
}

const marketingOrigin = localSurfaceOrigin(
  import.meta.env.VITE_MARKETING_ORIGIN,
  "http://localhost:4321",
);
const docsOrigin = localSurfaceOrigin(
  import.meta.env.VITE_DOCS_ORIGIN,
  "http://localhost:4322",
);

export function appGlobalPath(pathname: string): string {
  return `/app${pathname}`;
}

function MemberToolLinks(props: { pathname: string }) {
  return (
    <>
      <a
        className="scout-navbar__link"
        href="/app/explore"
        aria-current={
          props.pathname.startsWith("/explore") ? "page" : undefined
        }
      >
        Explore
      </a>
      <a
        className="scout-navbar__link"
        href="/app/players"
        aria-current={
          props.pathname.startsWith("/players") ? "page" : undefined
        }
      >
        Players
      </a>
      <a className="scout-navbar__link" href="/app/manage">
        Manage servers
      </a>
    </>
  );
}

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
    <div className="scout-page-frame">
      <GlobalNavbar
        signedIn={username !== undefined}
        currentPath={appGlobalPath(location.pathname)}
        utility={
          username === undefined ? undefined : (
            <nav
              className="scout-navbar__member-links"
              aria-label="Member tools"
            >
              <MemberToolLinks pathname={location.pathname} />
            </nav>
          )
        }
        mobileNavigation={
          username === undefined ? undefined : (
            <MemberToolLinks pathname={location.pathname} />
          )
        }
        accountMenu={
          username === undefined ? undefined : <UserMenu username={username} />
        }
        origins={{ marketing: marketingOrigin, docs: docsOrigin }}
      />
      <ContractMismatchBanner />
      <FeedbackPrompt />
      <main>
        <Outlet />
      </main>
      <GlobalFooter
        release={buildInfo.version}
        commit={buildInfo.gitSha}
        origins={{ marketing: marketingOrigin, docs: docsOrigin }}
      />
    </div>
  );
}
