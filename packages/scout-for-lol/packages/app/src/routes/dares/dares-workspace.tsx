import type { DiscordGuildId } from "@scout-for-lol/data";
import { Loaded } from "@shepherdjerred/loaded";
import { useDelayedLoading } from "@shepherdjerred/loaded/react.tsx";
import { useEffect, useState, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useOutletContext,
} from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  ErrorState,
  LoadingState,
} from "@scout-for-lol/design-system/domain/states";
import { EmptyState } from "@scout-for-lol/design-system/layout";
import {
  analyticsContextRoute,
  clearGuildContext,
  resolveGuildContext,
} from "#src/lib/analytics.ts";
import { cn } from "#src/lib/cn.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

export type DaresOutletContext = {
  guildId: DiscordGuildId;
  guildName: string;
  daresAvailable: boolean;
};

export function useDaresGuild(): DaresOutletContext {
  return useOutletContext<DaresOutletContext>();
}

export function daresSectionItems(_daresAvailable: boolean): {
  label: string;
  to: string;
  end: boolean;
}[] {
  return [
    { label: "Dares", to: "/dares", end: true },
    { label: "Settings", to: "/dares/settings", end: false },
  ];
}

export type DaresGuildSelection = {
  /**
   * True only while a real choice is pending: more than one guild is
   * available and the member hasn't picked one yet. Distinct from "no guild"
   * (forbidden/error/unavailable), which is a settled answer — an analytics
   * gate keyed only on `guildId === undefined` would mark the route ready
   * before a guild exists, and picking one later would never retrigger the
   * entry pageview.
   */
  awaitingGuildChoice: boolean;
  guildId: DiscordGuildId | undefined;
};

/** Pure guild-selection resolution, shared by the analytics gate and the render path. */
export function resolveDaresGuildSelection(input: {
  availableGuilds: { id: DiscordGuildId }[] | undefined;
  selectedGuildId: string | null;
}): DaresGuildSelection {
  const { availableGuilds, selectedGuildId } = input;
  if (availableGuilds === undefined) {
    return { awaitingGuildChoice: false, guildId: undefined };
  }
  if (availableGuilds.length === 1) {
    return { awaitingGuildChoice: false, guildId: availableGuilds[0]?.id };
  }
  const selected = availableGuilds.find(
    (candidate) => candidate.id === selectedGuildId,
  );
  return {
    awaitingGuildChoice: selected === undefined,
    guildId: selected?.id,
  };
}

function SectionNav(props: { daresAvailable: boolean }) {
  return (
    <nav className="flex gap-1">
      {daresSectionItems(props.daresAvailable).map((item) => (
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

function DaresPage(props: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
      {props.children}
    </div>
  );
}

/**
 * The Dares consumer surface. The whole gate is the server-side status
 * probe: identical SPA bytes ship to beta and prod, so an unavailable answer —
 * or a deep link on a stage where the feature is dark — renders a neutral
 * card that never mentions how the feature is scoped.
 */
export function DaresWorkspace() {
  const trpc = useTRPC();
  const location = useLocation();
  const statusQuery = useQuery(
    trpc.dares.status.queryOptions(undefined, { retry: 2 }),
  );
  const [selectedGuildId, setSelectedGuildId] = useState<string | null>(null);

  // Computed independently of the narrowed render-path `guild` below so this
  // can feed the analytics effect ahead of any early return (hooks must run
  // unconditionally on every render).
  const availableGuilds =
    statusQuery.data?.state === "available"
      ? statusQuery.data.guilds
      : undefined;
  const { awaitingGuildChoice, guildId: resolvedGuildId } =
    resolveDaresGuildSelection({ availableGuilds, selectedGuildId });

  // This is the only component mounted for every `/dares*` route, so — like
  // `GuildWorkspace` for `/g/:guildId` — it owns the guild super property for
  // every Dare pageview and mutation event. "Settled" means the status probe
  // has answered AND, if multiple guilds are available, one has been picked —
  // a forbidden/error result is a settled "no guild attached" answer, but an
  // unresolved multi-guild picker is not: it stays unresolved until a guild is
  // chosen, so the root layout's entry-pageview gate waits for that pick.
  const contextRoute = analyticsContextRoute(location.pathname);
  useEffect(() => {
    if (
      awaitingGuildChoice ||
      contextRoute === undefined ||
      statusQuery.isPending
    ) {
      return;
    }
    resolveGuildContext(contextRoute, resolvedGuildId);
    return () => {
      clearGuildContext();
    };
  }, [
    contextRoute,
    statusQuery.isPending,
    awaitingGuildChoice,
    resolvedGuildId,
  ]);

  // This probe *is* the gate for the Dare outlet, not something rendered
  // inside an already-gated one: the backend resolves Dare scope from live
  // Discord membership on every request, so a cached "available" cannot
  // authorize the outlet once the recheck starts failing. `strict` keeps
  // every page beneath this route closed until the probe succeeds again.
  const statusValue = Loaded.strict(
    Loaded.fromQuery(statusQuery, ["dares.status"]),
  );
  const showLoading = useDelayedLoading(statusValue.status === "loading");
  if (statusValue.status === "error") {
    return (
      <DaresPage>
        <ErrorState
          title="Dares couldn't load"
          message="Scout couldn't check Dares availability."
          onRetry={() => {
            void statusQuery.refetch();
          }}
        />
      </DaresPage>
    );
  }
  if (showLoading) {
    return (
      <DaresPage>
        <LoadingState label="Checking Dares availability…" />
      </DaresPage>
    );
  }
  if (statusValue.status === "loading") {
    return null;
  }
  const status = statusValue.data;
  if (status.state !== "available") {
    return (
      <DaresPage>
        <EmptyState>
          <h2>Dares isn&apos;t available here</h2>
          <p>Dares isn&apos;t running in any of your servers.</p>
          <Button asChild>
            <Link to="/">Back to Scout</Link>
          </Button>
        </EmptyState>
      </DaresPage>
    );
  }

  const guild = status.guilds.find(
    (candidate) => candidate.id === resolvedGuildId,
  );
  if (guild === undefined) {
    return (
      <DaresPage>
        <EmptyState>
          <h2>Pick a server</h2>
          <p>Dares is running in more than one of your servers.</p>
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
      </DaresPage>
    );
  }

  const context: DaresOutletContext = {
    guildId: guild.id,
    guildName: guild.name,
    daresAvailable: guild.daresAvailable,
  };
  return (
    <DaresPage>
      <SectionNav daresAvailable={guild.daresAvailable} />
      <Outlet context={context} />
    </DaresPage>
  );
}
