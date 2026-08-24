import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { SESSION_QUERY_OPTIONS } from "#src/lib/session-query.ts";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import {
  isOnboardingComplete,
  isOnboardingSeen,
  markOnboardingComplete,
  markOnboardingSeen,
  shouldRedirectToOnboarding,
} from "#src/lib/onboarding-storage.ts";
import { trackOutboundClick } from "#src/lib/analytics.ts";
import { STALE_TIME_SLOW_LIST } from "#src/lib/stale-times.ts";

/**
 * Kicks off the bot-install flow. Points at the backend route (not an
 * SPA route), which 302s to Discord's add-to-server screen and returns
 * the admin to /app/installed?guild_id=… — see handleDiscordInstall.
 */
const INSTALL_URL = "/api/discord/install?surface=guild_picker";

function AddServerButton({
  variant = "default",
  children,
}: {
  variant?: "default" | "outline";
  children: React.ReactNode;
}) {
  return (
    <Button asChild variant={variant}>
      <a
        href={INSTALL_URL}
        onClick={(clickEvent) => {
          trackOutboundClick(clickEvent, "bot_install_click", INSTALL_URL, {
            surface: "guild_picker",
          });
        }}
      >
        {children}
      </a>
    </Button>
  );
}

export function GuildPicker() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const meQuery = useQuery(
    trpc.auth.sessionState.queryOptions(undefined, SESSION_QUERY_OPTIONS),
  );
  const { data } = useSuspenseQuery(
    trpc.guild.listManageable.queryOptions(undefined, {
      staleTime: STALE_TIME_SLOW_LIST,
    }),
  );
  const discordId = meQuery.data?.user?.discordId ?? null;
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Keep incomplete users in the guided first-run experience. A user with no
  // manageable servers always belongs there, even if this browser previously
  // recorded setup as complete or abandoned. The install redirect (Discord →
  // /installed → /welcome) still completes setup without passing through here.
  useEffect(() => {
    if (discordId === null) return;
    if (
      !shouldRedirectToOnboarding(
        data.length > 0,
        isOnboardingComplete(discordId),
      )
    ) {
      return;
    }
    markOnboardingSeen(discordId);
    void navigate("/welcome", { replace: true });
  }, [data.length, discordId, navigate]);

  const showBanner =
    discordId !== null &&
    isOnboardingSeen(discordId) &&
    !isOnboardingComplete(discordId) &&
    !bannerDismissed;

  const banner = showBanner ? (
    <GetStartedBanner
      onDismiss={() => {
        markOnboardingComplete(discordId);
        setBannerDismissed(true);
      }}
    />
  ) : null;

  if (data.length === 0) {
    return (
      <Shell>
        {banner}
        <Card>
          <CardHeader>
            <CardTitle>Add Scout to your server</CardTitle>
            <CardDescription>
              You need to be a Discord Administrator in a server with Scout
              installed. Add Scout below — you&apos;ll come right back here to
              configure it.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <AddServerButton>Add Scout to a server</AddServerButton>
            <Button asChild variant="outline">
              <Link to="/welcome">Open setup guide</Link>
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      {banner}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Pick a guild</h1>
        <div className="flex items-center gap-3">
          <Link
            to="/explore"
            className="text-sm text-scout-subtle hover:text-scout-ink"
          >
            Explore
          </Link>
          <Link
            to="/welcome"
            className="text-sm text-scout-subtle hover:text-scout-ink"
          >
            Setup guide
          </Link>
          <AddServerButton variant="outline">
            Add another server
          </AddServerButton>
        </div>
      </div>
      <ul className="grid gap-2">
        {data.map((g) => (
          <li key={g.id}>
            <Link
              to={`/g/${g.id}`}
              className="flex items-center gap-3 rounded-md border border-border bg-scout-surface p-3 text-scout-ink transition-colors hover:bg-scout-accent hover:text-scout-accent-ink"
            >
              {g.icon === null ? (
                <div className="h-8 w-8 shrink-0 rounded-md bg-scout-hover" />
              ) : (
                <img
                  src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 shrink-0 rounded-md"
                />
              )}
              <span className="flex-1 truncate font-medium">{g.name}</span>
              {g.isOwner && (
                <span className="text-xs text-scout-subtle">owner</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function GetStartedBanner(props: { onDismiss: () => void }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">New to Scout?</CardTitle>
        <CardDescription>
          Take the quick setup guide to track your first player and learn the
          basics.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2 pt-0">
        <Button asChild size="sm">
          <Link to="/welcome">Start setup guide</Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onDismiss}>
          Dismiss
        </Button>
      </CardContent>
    </Card>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8 sm:py-12">
      {children}
    </div>
  );
}
