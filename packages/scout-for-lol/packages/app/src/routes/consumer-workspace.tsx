import { useEffect } from "react";
import { Loaded } from "@shepherdjerred/loaded";
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
  const { access } = usePermissions(guildId);
  const contextRoute = analyticsContextRoute(location.pathname);

  // `guildId` is an unvalidated route param until the permission bootstrap
  // resolves, so the guild super property is only registered once the server
  // has confirmed the guild — otherwise any signed-in visitor could deep-link
  // `/c/<anything>` and stamp an arbitrary value onto every subsequent event.
  const analyticsGuildId = access.status === "done" ? guildId : undefined;
  useEffect(() => {
    if (contextRoute === undefined || access.status === "loading") return;
    resolveGuildContext(contextRoute, analyticsGuildId);
    return () => {
      clearGuildContext();
    };
  }, [contextRoute, access.status, analyticsGuildId]);

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
