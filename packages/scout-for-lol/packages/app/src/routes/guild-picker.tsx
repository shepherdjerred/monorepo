import { Loaded } from "@shepherdjerred/loaded";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Compass, Settings } from "lucide-react";
import { useTRPC } from "#src/lib/trpc.ts";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";

export function resolveMemberDestination(input: {
  exploreAvailable: boolean;
  profilesAvailable: boolean;
}): "/explore" | "/players" | null {
  if (input.exploreAvailable) return "/explore";
  if (input.profilesAvailable) return "/players";
  return null;
}

export function GuildPicker() {
  const trpc = useTRPC();
  const exploreQuery = useQuery(trpc.explore.status.queryOptions());
  const profilesQuery = useQuery(
    trpc.consumerPlayer.status.queryOptions(undefined, { retry: 2 }),
  );
  const memberDestination = resolveMemberDestination({
    exploreAvailable: exploreQuery.data?.enabled === true,
    profilesAvailable: profilesQuery.data?.state === "available",
  });
  // Both checks answer one question — can this visitor use the member card —
  // so they are joined rather than ORed field by field. `error` here means
  // neither check produced an answer; if one succeeded and the other's refresh
  // failed, the join is `degraded` and the card stays usable.
  const member = Loaded.all({
    explore: Loaded.fromQuery(exploreQuery, ["explore.status"]),
    profiles: Loaded.fromQuery(profilesQuery, ["consumerPlayer.status"]),
  });
  const memberPending = member.status === "loading";
  const memberError = member.status === "error";

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
      <div className="space-y-2">
        <p className="text-sm font-medium text-primary">Scout dashboard</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Choose how you want to use Scout
        </h1>
        <p className="max-w-2xl text-scout-subtle">
          Discover the games Scout recorded as a server member, or administer
          and install Scout for a Discord server.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ExperienceCard
          title="Explore Scout"
          description="Ask questions across Scout's recorded games and find configured players from enabled servers you share."
          icon={<Compass aria-hidden="true" />}
        >
          {memberPending ? (
            <p className="text-sm text-scout-subtle">Checking access…</p>
          ) : memberError ? (
            <div className="space-y-3">
              <p className="text-sm text-scout-subtle">
                Scout couldn&apos;t verify your member access. This is usually
                temporary.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  void exploreQuery.refetch();
                  void profilesQuery.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          ) : memberDestination === null ? (
            <p className="text-sm text-scout-subtle">
              Member discovery is not enabled for a Scout server you currently
              share. Administrator permission is not required when it becomes
              available.
            </p>
          ) : (
            <Button asChild size="lg">
              <Link to={memberDestination}>Explore Scout</Link>
            </Button>
          )}
        </ExperienceCard>

        <ExperienceCard
          title="Manage Scout"
          description="Open an existing server workspace, continue setup, or add Scout to a new Discord server."
          icon={<Settings aria-hidden="true" />}
        >
          <Button asChild size="lg" variant="outline">
            <Link to="/manage">Manage Scout</Link>
          </Button>
        </ExperienceCard>
      </div>
    </div>
  );
}

function ExperienceCard(props: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex min-h-72 flex-col border-primary/30 bg-gradient-to-br from-scout-surface to-scout-hover/40">
      <CardHeader className="flex-1 space-y-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          {props.icon}
        </div>
        <div className="space-y-2">
          <CardTitle className="text-2xl" aria-level={2}>
            {props.title}
          </CardTitle>
          <CardDescription>{props.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}
