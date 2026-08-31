import { useQuery } from "@tanstack/react-query";
import { NavLink, useLocation, useNavigate } from "react-router";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import {
  consumerNavigationItems,
  guildIdFromAppPath,
  guildWorkspacePath,
  visibleGuildNavigationItems,
} from "#src/lib/app-navigation.ts";
import { STALE_TIME_SLOW_LIST } from "#src/lib/stale-times.ts";
import { useTRPC } from "#src/lib/trpc.ts";

export function AppNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const trpc = useTRPC();
  const guildId = guildIdFromAppPath(location.pathname);
  const guildsQuery = useQuery(
    trpc.guild.listManageable.queryOptions(undefined, {
      staleTime: STALE_TIME_SLOW_LIST,
    }),
  );
  const exploreQuery = useQuery(trpc.explore.status.queryOptions());
  const profilesQuery = useQuery(
    trpc.consumerPlayer.status.queryOptions(undefined, { retry: 2 }),
  );
  const bucksQuery = useQuery(
    trpc.bucks.status.queryOptions(undefined, { retry: 2 }),
  );
  const { perms } = usePermissions(guildId);

  const tools = consumerNavigationItems({
    exploreAvailable: exploreQuery.data?.enabled === true,
    profilesAvailable: profilesQuery.data?.state === "available",
    bucksAvailable: bucksQuery.data?.state === "available",
  });
  const selectedGuild = guildsQuery.data?.find((guild) => guild.id === guildId);
  const guildItems = visibleGuildNavigationItems(
    (permission) => perms.can(permission.resource, permission.action),
    selectedGuild?.customNightsEnabled === true,
  );

  return (
    <nav className="scout-app-sidebar-nav" aria-label="App navigation">
      {tools.length === 0 ? null : (
        <section className="scout-app-sidebar-section" aria-label="Tools">
          <p className="scout-app-sidebar-heading">Tools</p>
          {tools.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className="scout-app-sidebar-link"
            >
              {item.label}
            </NavLink>
          ))}
        </section>
      )}
      <section className="scout-app-sidebar-section" aria-label="Servers">
        <p className="scout-app-sidebar-heading">Servers</p>
        <label className="scout-app-sidebar-field">
          Server
          <select
            name="server"
            className="scout-app-sidebar-select"
            value={guildId ?? ""}
            disabled={guildsQuery.isPending || guildsQuery.isError}
            onChange={(event) => {
              const nextGuildId = event.currentTarget.value;
              if (nextGuildId.length > 0) {
                void navigate(guildWorkspacePath(nextGuildId));
              }
            }}
          >
            <option value="" disabled>
              {guildsQuery.isPending
                ? "Loading servers…"
                : guildsQuery.isError
                  ? "Servers unavailable"
                  : "Choose a server"}
            </option>
            {guildsQuery.data?.map((guild) => (
              <option key={guild.id} value={guild.id}>
                {guild.name}
              </option>
            ))}
          </select>
        </label>
        <NavLink to="/manage" end className="scout-app-sidebar-link">
          Manage servers
        </NavLink>
        {guildId === undefined ? null : (
          <div className="scout-app-sidebar-server">
            <p className="scout-app-sidebar-server-name">
              {selectedGuild?.name ?? "Current server"}
            </p>
            {guildItems.map((item) => (
              <NavLink
                key={item.to}
                to={`/g/${guildId}/${item.to}`}
                className="scout-app-sidebar-link"
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        )}
      </section>
    </nav>
  );
}
