import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { Button } from "#src/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";
import {
  isOnboardingComplete,
  isOnboardingSeen,
  markOnboardingComplete,
  markOnboardingSeen,
} from "#src/lib/onboarding-storage.ts";

/**
 * Kicks off the bot-install flow. Points at the backend route (not an
 * SPA route), which 302s to Discord's add-to-server screen and returns
 * the admin to /app/installed?guild_id=… — see handleDiscordInstall.
 */
const INSTALL_URL = "/api/discord/install";

function AddServerButton({
  variant = "default",
  children,
}: {
  variant?: "default" | "outline";
  children: React.ReactNode;
}) {
  return (
    <Button asChild variant={variant}>
      <a href={INSTALL_URL}>{children}</a>
    </Button>
  );
}

export function GuildPicker() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const meQuery = useQuery(
    trpc.auth.meWeb.queryOptions(undefined, { retry: false }),
  );
  const { data, isLoading, error } = useQuery(
    trpc.guild.listManageable.queryOptions(),
  );
  const discordId = meQuery.data?.discordId ?? null;
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // First sign-in for this user: send them through the guided setup once.
  useEffect(() => {
    if (discordId === null) return;
    if (!isOnboardingSeen(discordId)) {
      markOnboardingSeen(discordId);
      void navigate("/welcome", { replace: true });
    }
  }, [discordId, navigate]);

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

  if (isLoading) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">Loading guilds…</p>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <p className="text-sm text-destructive">
          Failed to load guilds: {error.message}
        </p>
      </Shell>
    );
  }

  if (data === undefined || data.length === 0) {
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
        <h2 className="text-xl font-semibold tracking-tight">Pick a guild</h2>
        <div className="flex items-center gap-3">
          <Link
            to="/welcome"
            className="text-sm text-muted-foreground hover:text-foreground"
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
              className="flex items-center gap-3 rounded-md border border-border bg-card p-3 text-card-foreground transition-colors hover:bg-accent"
            >
              {g.icon === null ? (
                <div className="h-8 w-8 shrink-0 rounded-md bg-muted" />
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
                <span className="text-xs text-muted-foreground">owner</span>
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
