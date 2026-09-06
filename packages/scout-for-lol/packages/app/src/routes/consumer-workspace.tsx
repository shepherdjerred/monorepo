import { useEffect } from "react";
import { Outlet, useLocation, useParams } from "react-router";
import { ForbiddenPanel } from "#src/components/forbidden-panel.tsx";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import {
  analyticsContextRoute,
  clearGuildContext,
  resolveGuildContext,
} from "#src/lib/analytics.ts";

export function ConsumerWorkspace() {
  return <Outlet />;
}

export function ConsumerGuildWorkspace() {
  const { guildId } = useParams();
  const location = useLocation();
  const { isLoading, error } = usePermissions(guildId);
  const contextRoute = analyticsContextRoute(location.pathname);

  useEffect(() => {
    if (contextRoute === undefined || isLoading) return;
    resolveGuildContext(contextRoute, error === null ? guildId : undefined);
    return () => {
      clearGuildContext();
    };
  }, [contextRoute, error, guildId, isLoading]);

  if (guildId === undefined) {
    return (
      <ForbiddenPanel
        title="Missing guild id"
        message="This guild-scoped route requires a guild."
      />
    );
  }
  if (isLoading) return null;
  if (error !== null) {
    return (
      <ForbiddenPanel
        title="No access to this server"
        message={error.message}
      />
    );
  }
  return <Outlet />;
}
