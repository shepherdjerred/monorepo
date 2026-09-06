import { useEffect } from "react";
import { Outlet, useLocation, useParams } from "react-router";
import { Loaded } from "@shepherdjerred/loaded";
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
  const { access } = usePermissions(guildId);
  const contextRoute = analyticsContextRoute(location.pathname);

  useEffect(() => {
    if (contextRoute === undefined || access.status === "loading") return;
    resolveGuildContext(
      contextRoute,
      access.status === "error" ? undefined : guildId,
    );
    return () => {
      clearGuildContext();
    };
  }, [contextRoute, access.status, guildId]);

  if (guildId === undefined) {
    return (
      <ForbiddenPanel
        title="Missing guild id"
        message="This guild-scoped route requires a guild."
      />
    );
  }
  if (access.status === "loading") return null;
  if (access.status === "error") {
    return (
      <ForbiddenPanel
        title="No access to this server"
        message={Loaded.messageOf(access.errors[0].error)}
      />
    );
  }
  return <Outlet />;
}
