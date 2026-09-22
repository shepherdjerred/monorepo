import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { ErrorPanel } from "#src/components/chrome/route-error-panel.tsx";
import { ForbiddenPanel } from "#src/components/chrome/forbidden-panel.tsx";
import { useTRPC, type RouterOutputs } from "#src/lib/query/trpc.ts";
import {
  formatClashInstant,
  phaseLabel,
  titleCaseToken,
} from "#src/routes/consumer/consumer-clash-copy.ts";
import { ClashHistorySection } from "#src/routes/consumer/consumer-clash-history.tsx";

const RESULTS_NOTE =
  "Current Clash games are pre-match only. Riot does not publish results, so Scout cannot score them.";

const PLACEHOLDER_GUILD = DiscordGuildIdSchema.parse("1".repeat(17));

type QueryView<T> = {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: { message: string } | null;
  data: T | undefined;
};
type ClashGuild = Extract<
  RouterOutputs["clash"]["status"],
  { state: "available" }
>["guilds"][number];

function ClashShell(props: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
      {props.children}
    </div>
  );
}

function ClashScheduleSection(props: {
  schedule: QueryView<RouterOutputs["clash"]["schedule"]>;
  now: number;
}) {
  const tournaments = props.schedule.data?.tournaments ?? [];
  return (
    <section className="space-y-3" aria-labelledby="clash-schedule-title">
      <div>
        <h2 id="clash-schedule-title" className="text-xl font-semibold">
          Schedule
        </h2>
        <p className="text-sm text-scout-subtle">
          Upcoming phases from Clash-v1 for platforms Scout snapshots.
        </p>
      </div>
      {props.schedule.isPending ? (
        <p className="text-sm text-scout-subtle">Loading schedule…</p>
      ) : null}
      {props.schedule.isError ? (
        <p className="text-sm text-scout-danger">
          {props.schedule.error?.message ?? "Unable to load schedule"}
        </p>
      ) : null}
      {props.schedule.isSuccess && tournaments.length === 0 ? (
        <p className="text-sm text-scout-subtle">No Clash weekend posted.</p>
      ) : null}
      <div className="grid gap-3">
        {tournaments.map((tournament) => (
          <Card key={`${tournament.platform}:${String(tournament.riotId)}`}>
            <CardHeader>
              <CardTitle>{tournament.themeLabel}</CardTitle>
              <CardDescription>{tournament.platform}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {tournament.phases.map((phase) => (
                <div
                  key={phase.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>
                    Registration {formatClashInstant(phase.registrationTime)}
                    {" · "}
                    Start {formatClashInstant(phase.startTime)}
                  </span>
                  <Badge variant="secondary">
                    {phaseLabel({ ...phase, now: props.now })}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function ClashGuildPicker(props: {
  guilds: readonly ClashGuild[];
  rosterGuildId: string | undefined;
  onSelectGuild: (guildId: string) => void;
}) {
  if (props.guilds.length <= 1) {
    return null;
  }
  return (
    <label className="grid gap-1 text-sm" htmlFor="clash-guild">
      <span className="text-scout-subtle">Server</span>
      <select
        id="clash-guild"
        className="rounded-lg border border-scout-border/60 bg-scout-canvas px-2.5 py-2 text-sm"
        value={props.rosterGuildId ?? ""}
        onChange={(event) => {
          props.onSelectGuild(event.currentTarget.value);
        }}
      >
        {props.guilds.map((guild) => (
          <option key={guild.id} value={guild.id}>
            {guild.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ClashRosterSection(props: {
  roster: QueryView<RouterOutputs["clash"]["roster"]>;
  registrationOpen: boolean;
}) {
  const teams = props.roster.data?.teams ?? [];
  const emptyMessage = props.registrationOpen
    ? "Registration is open, nobody tracked has signed up."
    : "No tracked player in this server is registered in the current snapshot.";
  return (
    <section className="space-y-3" aria-labelledby="clash-roster-title">
      <div>
        <h2 id="clash-roster-title" className="text-xl font-semibold">
          Roster
        </h2>
        <p className="text-sm text-scout-subtle">
          Tracked players registered this weekend. Untracked teammates stay
          unresolved.
        </p>
      </div>
      {props.roster.isPending ? (
        <p className="text-sm text-scout-subtle">Loading roster…</p>
      ) : null}
      {props.roster.isError ? (
        <p className="text-sm text-scout-danger">
          {props.roster.error?.message ?? "Unable to load roster"}
        </p>
      ) : null}
      {props.roster.isSuccess && teams.length === 0 ? (
        <p className="text-sm text-scout-subtle">{emptyMessage}</p>
      ) : null}
      <div
        className={
          teams.length > 1 ? "grid gap-3 md:grid-cols-2" : "grid gap-3"
        }
      >
        {teams.map((team) => (
          <Card key={`${team.platform}:${team.teamRiotId}`}>
            <CardHeader>
              <CardTitle>
                {team.abbreviation} · {team.name}
              </CardTitle>
              <CardDescription>
                {team.themeLabel} · {team.platform}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {team.members.map((member) => (
                <div
                  key={`${member.puuid}:${member.role}`}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>{member.playerAlias}</span>
                  <span className="text-scout-subtle">
                    {titleCaseToken(member.role)}
                    {" · "}
                    {titleCaseToken(member.position)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function ConsumerClash() {
  const trpc = useTRPC();
  const now = Date.now();
  const status = useQuery(
    trpc.clash.status.queryOptions(undefined, { retry: 2 }),
  );
  const guilds = status.data?.state === "available" ? status.data.guilds : [];
  const [selectedGuildId, setSelectedGuildId] = useState<string | undefined>(
    undefined,
  );
  const rosterGuildParsed = DiscordGuildIdSchema.safeParse(
    selectedGuildId ?? guilds[0]?.id,
  );
  const rosterGuildId = rosterGuildParsed.success
    ? rosterGuildParsed.data
    : undefined;
  const schedule = useQuery({
    ...trpc.clash.schedule.queryOptions(),
    enabled: status.data?.state === "available",
  });
  const roster = useQuery({
    ...trpc.clash.roster.queryOptions({
      guildId: rosterGuildId ?? PLACEHOLDER_GUILD,
    }),
    enabled: status.data?.state === "available" && rosterGuildId !== undefined,
  });
  const history = useQuery({
    ...trpc.clash.history.queryOptions({
      guildId: rosterGuildId ?? PLACEHOLDER_GUILD,
    }),
    enabled: status.data?.state === "available" && rosterGuildId !== undefined,
  });

  if (status.isPending) {
    return (
      <ClashShell>
        <p className="text-sm text-scout-subtle">
          Checking Clash availability…
        </p>
      </ClashShell>
    );
  }
  if (status.isError) {
    return (
      <ClashShell>
        <ErrorPanel
          title="Unable to check Clash"
          message={status.error.message}
          onRetry={() => {
            void status.refetch();
          }}
        />
      </ClashShell>
    );
  }
  if (status.data.state !== "available") {
    return (
      <ClashShell>
        <ForbiddenPanel
          title="Clash is unavailable"
          message="Clash schedule, roster, and history are off for the servers you share with Scout."
        />
      </ClashShell>
    );
  }

  const registrationOpen = (schedule.data?.tournaments ?? []).some(
    (tournament) =>
      tournament.phases.some(
        (phase) => phaseLabel({ ...phase, now }) === "Registration open",
      ),
  );

  return (
    <ClashShell>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <p className="text-sm font-medium text-primary">This weekend</p>
          <h1 className="text-3xl font-semibold tracking-tight">Clash</h1>
          <p className="max-w-2xl text-scout-subtle">{RESULTS_NOTE}</p>
        </div>
        <ClashGuildPicker
          guilds={guilds}
          rosterGuildId={rosterGuildId}
          onSelectGuild={setSelectedGuildId}
        />
      </header>
      <ClashScheduleSection
        schedule={{
          isPending: schedule.isPending,
          isError: schedule.isError,
          isSuccess: schedule.isSuccess,
          error: schedule.error,
          data: schedule.data,
        }}
        now={now}
      />
      <ClashRosterSection
        roster={{
          isPending: roster.isPending,
          isError: roster.isError,
          isSuccess: roster.isSuccess,
          error: roster.error,
          data: roster.data,
        }}
        registrationOpen={registrationOpen}
      />
      <ClashHistorySection
        history={{
          isPending: history.isPending,
          isError: history.isError,
          isSuccess: history.isSuccess,
          error: history.error,
          data: history.data,
        }}
      />
    </ClashShell>
  );
}
