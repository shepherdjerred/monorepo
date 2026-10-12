import { Loaded } from "@shepherdjerred/loaded";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Compass, Settings, Users } from "lucide-react";
import { useTRPC } from "#src/lib/query/trpc.ts";
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
  return input.profilesAvailable
    ? "/players"
    : input.exploreAvailable
      ? "/explore"
      : null;
}

export function GuildPicker() {
  const trpc = useTRPC();
  const exploreQuery = useQuery(trpc.explore.status.queryOptions());
  const profilesQuery = useQuery(
    trpc.consumerPlayer.status.queryOptions(undefined, { retry: 2 }),
  );
  const explore = Loaded.strict(
    Loaded.fromQuery(exploreQuery, ["explore.status"]),
  );
  const profiles = Loaded.strict(
    Loaded.fromQuery(profilesQuery, ["consumerPlayer.status"]),
  );
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Scout</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <ExperienceCard
          title="Players"
          description="Review recent matches, champions, and progress."
          icon={<Users aria-hidden="true" />}
        >
          <AccessAction
            status={profiles.status}
            available={
              profiles.status === "done" && profiles.data.state === "available"
            }
            href="/players"
            label="View players"
            onRetry={() => void profilesQuery.refetch()}
          />
        </ExperienceCard>
        <ExperienceCard
          title="Explore"
          description="Ask questions about your League matches."
          icon={<Compass aria-hidden="true" />}
        >
          <AccessAction
            status={explore.status}
            available={explore.status === "done" && explore.data.enabled}
            href="/explore"
            label="Open Explore"
            onRetry={() => void exploreQuery.refetch()}
          />
        </ExperienceCard>
        <ExperienceCard
          title="Manage"
          description="Set up players, reports, and subscriptions for your server."
          icon={<Settings aria-hidden="true" />}
        >
          <Button asChild variant="outline">
            <Link to="/manage">Manage servers</Link>
          </Button>
        </ExperienceCard>
      </div>
    </div>
  );
}

function AccessAction(props: {
  status: string;
  available: boolean;
  href: string;
  label: string;
  onRetry: () => void;
}) {
  if (props.status === "loading")
    return <p className="text-sm text-scout-subtle">Checking access…</p>;
  if (props.status === "error")
    return (
      <div className="space-y-2">
        <p className="text-sm">Couldn’t check access.</p>
        <Button variant="outline" onClick={props.onRetry}>
          Retry
        </Button>
      </div>
    );
  if (!props.available)
    return (
      <p className="text-sm text-scout-subtle">
        Not enabled for your servers yet.
      </p>
    );
  return (
    <Button asChild>
      <Link to={props.href}>{props.label}</Link>
    </Button>
  );
}

function ExperienceCard(props: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-1 space-y-3">
        <div className="text-primary">{props.icon}</div>
        <CardTitle className="text-xl" aria-level={2}>
          {props.title}
        </CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}
