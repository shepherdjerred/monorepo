import { NavLink, Outlet } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ProductSubnavigation } from "@scout-for-lol/design-system/layout";
import { cn } from "#src/lib/cn.ts";
import { useTRPC } from "#src/lib/trpc.ts";

export function consumerNavigationItems(input: {
  exploreAvailable: boolean;
  profilesAvailable: boolean;
}): { label: string; to: string }[] {
  return [
    ...(input.exploreAvailable ? [{ label: "Explore", to: "/explore" }] : []),
    ...(input.profilesAvailable ? [{ label: "Players", to: "/players" }] : []),
  ];
}

export function ConsumerWorkspace() {
  const trpc = useTRPC();
  const exploreQuery = useQuery(trpc.explore.status.queryOptions());
  const profilesQuery = useQuery(
    trpc.consumerPlayer.status.queryOptions(undefined, { retry: 2 }),
  );
  const items = consumerNavigationItems({
    exploreAvailable: exploreQuery.data?.enabled === true,
    profilesAvailable: profilesQuery.data?.state === "available",
  });

  return (
    <>
      {items.length > 0 ? (
        <ProductSubnavigation>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2 text-sm font-medium",
                  isActive
                    ? "bg-scout-brand text-scout-brand-ink"
                    : "text-scout-subtle hover:bg-scout-accent hover:text-scout-accent-ink",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </ProductSubnavigation>
      ) : null}
      <Outlet />
    </>
  );
}
