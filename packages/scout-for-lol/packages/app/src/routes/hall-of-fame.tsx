import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "react-router";
import { Check, ChevronsUpDown, Server } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@scout-for-lol/design-system/components/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";
import { ErrorPanel } from "#src/components/chrome/route-error-panel.tsx";
import { useHallParams } from "#src/lib/routes/route-params.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

function recordValue(value: number | null, precision: number): string {
  return value === null ? "—" : value.toFixed(precision);
}

function formatRecordDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function HallPicker() {
  const trpc = useTRPC();
  const status = useQuery(
    trpc.hall.status.queryOptions(undefined, { retry: 2 }),
  );

  if (status.isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
        <p className="text-sm text-scout-subtle">
          Checking Hall of Fame availability…
        </p>
      </div>
    );
  }

  if (status.isError) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
        <ErrorPanel
          title="Unable to check Hall of Fame"
          message={status.error.message}
          onRetry={() => {
            void status.refetch();
          }}
        />
      </div>
    );
  }

  const guilds = status.data.state === "available" ? status.data.guilds : [];

  if (guilds.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
        <Card>
          <CardHeader>
            <CardTitle>Hall of Fame unavailable</CardTitle>
            <CardDescription>
              Hall of Fame is not enabled in any Discord server you currently
              share.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/">Back to Scout</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (guilds.length === 1 && guilds[0] !== undefined) {
    return <Navigate to={`/halls/${guilds[0].id}`} replace />;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
      <header className="space-y-2">
        <p className="text-sm font-medium text-primary">Guild records</p>
        <h1 className="text-3xl font-semibold tracking-tight">Hall of Fame</h1>
        <p className="max-w-2xl text-scout-subtle">
          Select a server to view its single-game Hall of Fame records.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {guilds.map((guild) => (
          <Card key={guild.id} className="flex flex-col justify-between">
            <CardHeader className="space-y-2">
              <div className="flex size-10 items-center justify-center rounded-lg border border-scout-border/60 bg-scout-canvas text-sm font-semibold text-scout-ink">
                {guild.name.slice(0, 2).toUpperCase()}
              </div>
              <CardTitle className="text-xl">{guild.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link to={`/halls/${guild.id}`}>View Hall of Fame</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function HallOfFame() {
  const { guildId } = useHallParams();
  const navigate = useNavigate();
  const trpc = useTRPC();
  const hall = useQuery(trpc.hall.get.queryOptions({ guildId }));
  const hallStatus = useQuery(
    trpc.hall.status.queryOptions(undefined, { retry: 2 }),
  );

  if (hall.isPending) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
        <p className="text-sm text-scout-subtle">Building the Hall…</p>
      </div>
    );
  }
  if (hall.isError) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
        <ErrorPanel
          title="Unable to load Hall of Fame"
          message={hall.error.message}
          onRetry={() => {
            void hall.refetch();
          }}
        />
      </div>
    );
  }
  const recordById = new Map(
    hall.data.catalog.hall.records.map((record) => [record.id, record]),
  );
  const entriesByFamily = Map.groupBy(
    hall.data.entries,
    (entry) => entry.queueFamilyId,
  );

  const availableGuilds =
    hallStatus.data?.state === "available" ? hallStatus.data.guilds : [];
  const currentGuild = availableGuilds.find((g) => g.id === guildId);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-primary">
              {currentGuild && availableGuilds.length > 1
                ? `${currentGuild.name} records`
                : "Guild records"}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Hall of Fame
            </h1>
          </div>
          {availableGuilds.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Server className="size-3.5 text-scout-subtle" />
                  <span>
                    {currentGuild ? currentGuild.name : "Switch server"}
                  </span>
                  <ChevronsUpDown className="size-3.5 text-scout-subtle" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Servers</DropdownMenuLabel>
                {availableGuilds.map((g) => (
                  <DropdownMenuItem
                    key={g.id}
                    onClick={() => {
                      void navigate(`/halls/${g.id}`);
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{g.name}</span>
                    {g.id === guildId && (
                      <Check className="size-4 shrink-0 text-scout-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {hall.data.settings.enabledQueueFamilies.map((familyId) => {
        const family = hall.data.catalog.hall.queueFamilies.find(
          (candidate) => candidate.id === familyId,
        );
        const entries = entriesByFamily.get(familyId) ?? [];
        if (family === undefined) return null;
        return (
          <Card key={familyId}>
            <CardHeader>
              <CardTitle>{family.label}</CardTitle>
              <CardDescription>{family.queues.join(" · ")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Record</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Holder</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Game</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const record = recordById.get(entry.recordId);
                    if (record === undefined) return null;
                    return (
                      <TableRow key={entry.recordId}>
                        <TableCell className="font-medium">
                          {record.label}
                        </TableCell>
                        <TableCell>
                          {recordValue(entry.currentValue, record.precision)}
                        </TableCell>
                        <TableCell>
                          {entry.holders.length === 0
                            ? "—"
                            : entry.holders.map((holder, idx) => (
                                <span
                                  key={`${holder.playerId.toString()}-${holder.accountId.toString()}`}
                                >
                                  {idx > 0 && ", "}
                                  <Link
                                    to={`/players/${holder.playerId.toString()}`}
                                    className="underline-offset-4 hover:underline"
                                  >
                                    {holder.playerAlias}
                                  </Link>
                                </span>
                              ))}
                        </TableCell>
                        <TableCell>
                          {entry.evidence.length === 0 ? (
                            <span className="text-scout-subtle">—</span>
                          ) : entry.evidence.length === 1 &&
                            entry.evidence[0] !== undefined ? (
                            <span
                              className="whitespace-nowrap text-sm text-scout-muted"
                              title={new Date(
                                entry.evidence[0].gameEndAt,
                              ).toLocaleString()}
                            >
                              {formatRecordDate(entry.evidence[0].gameEndAt)}
                            </span>
                          ) : (
                            <div className="flex flex-col gap-1 whitespace-nowrap text-sm text-scout-muted">
                              {entry.evidence.map((ev) => (
                                <span
                                  key={`${ev.holder.playerId.toString()}-${ev.matchId}`}
                                  title={new Date(
                                    ev.gameEndAt,
                                  ).toLocaleString()}
                                  className="text-xs"
                                >
                                  {formatRecordDate(ev.gameEndAt)}
                                </span>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {entry.evidence.length === 0 ? (
                            <span className="text-scout-subtle">—</span>
                          ) : entry.evidence.length === 1 &&
                            entry.evidence[0] !== undefined ? (
                            <Link
                              to={`/players/${entry.evidence[0].holder.playerId.toString()}/matches/${encodeURIComponent(entry.evidence[0].matchId)}`}
                              className="underline-offset-4 hover:underline text-primary"
                            >
                              View game
                            </Link>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {entry.evidence.map((ev) => (
                                <Link
                                  key={`${ev.holder.playerId.toString()}-${ev.matchId}`}
                                  to={`/players/${ev.holder.playerId.toString()}/matches/${encodeURIComponent(ev.matchId)}`}
                                  className="underline-offset-4 hover:underline text-primary text-xs"
                                >
                                  {ev.holder.playerAlias}&apos;s game
                                </Link>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}

      <p className="text-sm text-scout-subtle">
        Guild administrators can choose queues, records, and the announcement
        channel in{" "}
        <Link className="underline" to={`/g/${guildId}/hall-of-fame`}>
          Hall settings
        </Link>
        .
      </p>
    </div>
  );
}
