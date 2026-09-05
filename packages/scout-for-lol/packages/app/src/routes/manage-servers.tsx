import { Link } from "react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Plus, Settings } from "lucide-react";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { trackOutboundClick } from "#src/lib/analytics.ts";
import { STALE_TIME_SLOW_LIST } from "#src/lib/api/stale-times.ts";
import { useTRPC } from "#src/lib/trpc.ts";

const INSTALL_URL = "/api/discord/install?surface=manage_servers";

export function ManageServers() {
  const trpc = useTRPC();
  const { data: guilds } = useSuspenseQuery(
    trpc.guild.listManageable.queryOptions(undefined, {
      staleTime: STALE_TIME_SLOW_LIST,
    }),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
      <div className="space-y-2">
        <p className="text-sm font-medium text-primary">Administration</p>
        <h1 className="text-3xl font-semibold tracking-tight">Manage Scout</h1>
        <p className="max-w-2xl text-scout-subtle">
          Configure Scout for servers you can manage, or begin setup for a new
          Discord server.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" aria-hidden="true" />
            Set up a new server
          </CardTitle>
          <CardDescription>
            Sign in to Discord&apos;s installation flow, choose a server, then
            finish tracking your first player in Scout.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <a
              href={INSTALL_URL}
              onClick={(clickEvent) => {
                trackOutboundClick(
                  clickEvent,
                  "bot_install_click",
                  INSTALL_URL,
                  { surface: "manage_servers" },
                );
              }}
            >
              Set up a new server
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link to="/welcome">Open setup guide</Link>
          </Button>
        </CardContent>
      </Card>

      <section className="space-y-4" aria-labelledby="manageable-servers">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-scout-subtle" aria-hidden="true" />
          <h2 id="manageable-servers" className="text-xl font-semibold">
            Existing servers
          </h2>
        </div>
        {guilds.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No manageable servers</CardTitle>
              <CardDescription>
                You can still set up Scout for a server where Discord allows you
                to install apps.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {guilds.map((guild) => (
              <li key={guild.id}>
                <Link
                  to={`/g/${guild.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-scout-surface p-4 text-scout-ink transition-colors hover:border-primary/50 hover:bg-scout-hover"
                >
                  {guild.icon === null ? (
                    <div className="h-10 w-10 shrink-0 rounded-md bg-scout-hover" />
                  ) : (
                    <img
                      src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`}
                      alt=""
                      width={40}
                      height={40}
                      className="h-10 w-10 shrink-0 rounded-md"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {guild.name}
                  </span>
                  {guild.isOwner ? (
                    <span className="text-xs text-scout-subtle">owner</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
