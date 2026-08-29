import { useState } from "react";
import { Link, NavLink, Outlet, useOutletContext } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  ErrorState,
  LoadingState,
} from "@scout-for-lol/design-system/domain/states";
import { EmptyState } from "@scout-for-lol/design-system/layout";
import { cn } from "#src/lib/cn.ts";
import { useTRPC } from "#src/lib/trpc.ts";

export type BucksOutletContext = {
  guildId: string;
  guildName: string;
};

export function useBucksGuild(): BucksOutletContext {
  return useOutletContext<BucksOutletContext>();
}

export function bucksSectionItems(): {
  label: string;
  to: string;
  end: boolean;
}[] {
  return [
    { label: "Overview", to: "/bucks", end: true },
    { label: "History", to: "/bucks/history", end: false },
    { label: "Leaderboard", to: "/bucks/leaderboard", end: false },
    { label: "Settings", to: "/bucks/settings", end: false },
  ];
}

function SectionNav() {
  return (
    <nav className="mb-4 flex gap-1">
      {bucksSectionItems().map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
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
    </nav>
  );
}

/**
 * The Bryan Bucks consumer surface. The whole gate is the server-side status
 * probe: identical SPA bytes ship to beta and prod, so an unavailable answer —
 * or a deep link on a stage where the feature is dark — renders a neutral
 * card that never mentions how the feature is scoped.
 */
export function BucksWorkspace() {
  const trpc = useTRPC();
  const statusQuery = useQuery(
    trpc.bucks.status.queryOptions(undefined, { retry: 2 }),
  );
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);

  if (statusQuery.isPending) {
    return <LoadingState label="Checking Bryan Bucks availability…" />;
  }
  if (statusQuery.isError) {
    return (
      <ErrorState
        title="Bryan Bucks couldn't load"
        message="Scout couldn't check Bryan Bucks availability."
        onRetry={() => {
          void statusQuery.refetch();
        }}
      />
    );
  }
  const status = statusQuery.data;
  if (status.state !== "available") {
    return (
      <EmptyState>
        <h2>Bryan Bucks isn&apos;t available here</h2>
        <p>Bryan Bucks isn&apos;t running in any of your servers.</p>
        <Button asChild>
          <Link to="/">Back to Scout</Link>
        </Button>
      </EmptyState>
    );
  }

  const guild =
    status.guilds.length === 1
      ? status.guilds[0]
      : status.guilds.find((candidate) => candidate.id === selectedGuildId);
  if (guild === undefined) {
    return (
      <EmptyState>
        <h2>Pick a server</h2>
        <p>Bryan Bucks is running in more than one of your servers.</p>
        <div className="flex flex-wrap justify-center gap-2">
          {status.guilds.map((candidate) => (
            <Button
              key={candidate.id}
              type="button"
              variant="outline"
              onClick={() => {
                setSelectedGuildId(candidate.id);
              }}
            >
              {candidate.name}
            </Button>
          ))}
        </div>
      </EmptyState>
    );
  }

  const context: BucksOutletContext = {
    guildId: guild.id,
    guildName: guild.name,
  };
  return (
    <div>
      <SectionNav />
      <Outlet context={context} />
    </div>
  );
}
