import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";

export function GuildPicker() {
  const trpc = useTRPC();
  const { data, isLoading, error } = useQuery(
    trpc.guild.listManageable.queryOptions(),
  );

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
        <Card>
          <CardHeader>
            <CardTitle>No manageable guilds</CardTitle>
            <CardDescription>
              You need to be a Discord Administrator in a server where Scout is
              installed. Invite Scout, then come back here.
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <h2 className="text-xl font-semibold tracking-tight">Pick a guild</h2>
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8 sm:py-12">
      {children}
    </div>
  );
}
