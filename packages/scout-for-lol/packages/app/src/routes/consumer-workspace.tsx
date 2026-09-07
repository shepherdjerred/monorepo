import { Loaded } from "@shepherdjerred/loaded";
import { Outlet, useLocation, useParams } from "react-router";
import { ForbiddenPanel } from "#src/components/forbidden-panel.tsx";
import { useGuildAnalyticsContext } from "#src/hooks/use-guild-analytics-context.ts";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { analyticsContextRoute } from "#src/lib/analytics.ts";

export function ConsumerWorkspace() {
  return <Outlet />;
}

export function ConsumerGuildWorkspace() {
  const { guildId } = useParams();
  const location = useLocation();
  const { access } = usePermissions(guildId);
  const contextRoute = analyticsContextRoute(location.pathname);

  // `guildId` is unvalidated until the permission bootstrap resolves, so the
  // shared hook only registers the confirmed guild on analytics events.
  useGuildAnalyticsContext({
    contextRoute,
    loading: access.status === "loading",
    guildId: access.status === "done" ? guildId : undefined,
  });

  if (guildId === undefined) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8 sm:py-12">
        <ForbiddenPanel
          title="Missing guild id"
          message="This guild-scoped route requires a guild."
        />
      </div>
    );
  }
  if (access.status === "loading") return null;
  if (access.status === "error") {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8 sm:py-12">
        <ForbiddenPanel
          title="No access to this server"
          message={Loaded.messageOf(access.errors[0].error)}
        />
      </div>
    );
  }
  return <Outlet />;
}
