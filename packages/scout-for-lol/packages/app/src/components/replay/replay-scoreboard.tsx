import { memo } from "react";
import type { ReplaySessionState } from "@scout-for-lol/replay";
import type { ReplayInventoryItem } from "@scout-for-lol/replay/types";

const teams = [
  {
    id: 100,
    label: "Blue team",
    score: "blueKills",
    marker: "bg-blue-500",
  },
  {
    id: 200,
    label: "Red team",
    score: "redKills",
    marker: "bg-red-500",
  },
] as const;

type Scoreboard = NonNullable<ReplaySessionState["scoreboard"]>;

export const ReplayTeamScore = memo(function TeamScore({
  scoreboard,
}: {
  scoreboard: Scoreboard | undefined;
}) {
  if (scoreboard === undefined) return null;
  const winner = teams.find(({ id }) => id === scoreboard.winningTeam);
  const scoredTeams = teams.filter(({ score }) => scoreboard[score] !== null);
  if (winner === undefined && scoredTeams.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Replay team score"
      className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-b border-scout-border bg-scout-surface px-3 py-2 text-sm"
    >
      {scoredTeams.map(({ id, label, score, marker }) => (
        <div key={id} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${marker}`}
          />
          <span>{label}</span>
          <span className="font-semibold tabular-nums">
            {scoreboard[score]}
          </span>
          <span className="text-xs text-scout-subtle">kills</span>
        </div>
      ))}
      {winner !== undefined && (
        <p className="rounded-md border border-scout-border bg-scout-canvas px-2 py-1 font-semibold">
          {winner.label} won
        </p>
      )}
    </div>
  );
});

const statColumns = [
  { key: "kills", label: "Kills" },
  { key: "deaths", label: "Deaths" },
  { key: "assists", label: "Assists" },
  { key: "level", label: "Level" },
  { key: "gold", label: "Gold held" },
] as const;

const gaugeNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});
const goldNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const inventorySlots = [0, 1, 2, 3, 4, 5, 6] as const;

function RosterInventory({
  player,
  items,
}: {
  player: string;
  items: readonly (ReplayInventoryItem | null)[];
}) {
  return (
    <ul
      aria-label={`${player} items`}
      className="mt-1 flex list-none flex-wrap gap-0.5 p-0"
    >
      {inventorySlots.map((slot) => {
        const item = items[slot];
        return (
          <li
            key={slot}
            data-replay-item-slot={slot}
            className="relative size-6 overflow-hidden rounded-sm border border-scout-border bg-scout-surface"
            aria-hidden={item == null ? true : undefined}
          >
            {item != null && (
              <>
                <img
                  src={item.iconUrl}
                  alt={item.name}
                  width={item.width}
                  height={item.height}
                  className="size-full object-contain"
                  decoding="async"
                />
                {item.count > 1 && (
                  <span className="absolute right-0 bottom-0 rounded-tl-sm bg-black px-0.5 text-[0.625rem] leading-tight text-white">
                    {item.count}
                  </span>
                )}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const meterUnits = {
  health: "HP",
  resource: "resource",
  experience: "XP toward next level",
};

function RosterMeter({
  player,
  kind,
  gauge,
}: {
  player: string;
  kind: keyof typeof meterUnits;
  gauge: Readonly<{ current: number; max: number }>;
}) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-normal tabular-nums text-scout-subtle">
      <meter
        aria-label={`${player} ${kind}`}
        className="h-2 w-12 shrink-0 sm:w-16"
        min={0}
        max={gauge.max}
        value={gauge.current}
      />
      <span>
        {gaugeNumber.format(gauge.current)} / {gaugeNumber.format(gauge.max)}{" "}
        {meterUnits[kind]}
      </span>
    </span>
  );
}

export const ReplayRosterScore = memo(function RosterScore({
  participants,
  scoreboard,
}: {
  participants: ReplaySessionState["participants"];
  scoreboard: Scoreboard | undefined;
}) {
  if (scoreboard === undefined) return null;
  const scores = new Map(
    scoreboard.players.map((player) => [player.participantId, player]),
  );
  const entries = participants.flatMap((participant) => {
    const player = scores.get(participant.participantId);
    return player !== undefined &&
      (player.health !== undefined ||
        player.resource !== undefined ||
        player.experience !== undefined ||
        player.inventory !== undefined ||
        statColumns.some(({ key }) => hasRosterStat(player[key])))
      ? [{ participant, player }]
      : [];
  });
  if (entries.length === 0) return null;

  const activeTeams = teams.filter(({ id }) =>
    entries.some(({ participant }) => participant.teamId === id),
  );

  return (
    <div
      role="group"
      aria-label="Replay roster scores"
      className="grid gap-4 border-t border-scout-border bg-scout-canvas px-3 py-4 lg:grid-cols-2"
    >
      {activeTeams.map(({ id, label, marker }) => {
        const rows = entries.filter(
          ({ participant }) => participant.teamId === id,
        );
        const columns = statColumns.filter(({ key }) =>
          rows.some(({ player }) => hasRosterStat(player[key])),
        );
        return (
          <table key={id} className="w-full border-collapse text-xs sm:text-sm">
            <caption className="pb-2 text-left font-semibold">
              <span
                aria-hidden="true"
                className={`mr-2 inline-block size-2 rounded-full ${marker}`}
              />
              {label} roster
            </caption>
            <thead>
              <tr className="text-scout-subtle">
                <th scope="col" className="pb-1 text-left font-medium">
                  Player
                </th>
                {columns.map(({ key, label: stat }) => (
                  <th
                    key={key}
                    scope="col"
                    className="px-1 pb-1 text-right font-medium"
                  >
                    {stat}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ participant, player }) => (
                <tr
                  key={participant.participantId}
                  className="border-t border-scout-border"
                >
                  <th
                    scope="row"
                    className="py-2 pr-2 text-left font-medium [overflow-wrap:anywhere]"
                  >
                    {participant.name}
                    <span className="block text-xs font-normal text-scout-subtle">
                      {participant.championName}
                      {player.alive === false && (
                        <span className="ml-2 font-medium">Dead</span>
                      )}
                    </span>
                    {player.health !== undefined && (
                      <RosterMeter
                        player={participant.name}
                        kind="health"
                        gauge={player.health}
                      />
                    )}
                    {player.resource !== undefined && (
                      <RosterMeter
                        player={participant.name}
                        kind="resource"
                        gauge={player.resource}
                      />
                    )}
                    {player.experience?.progress !== undefined && (
                      <RosterMeter
                        player={participant.name}
                        kind="experience"
                        gauge={player.experience.progress}
                      />
                    )}
                    {player.experience !== undefined && (
                      <span
                        role="group"
                        aria-label={`${participant.name} total experience`}
                        className="mt-1 block text-xs font-normal tabular-nums text-scout-subtle"
                      >
                        {gaugeNumber.format(player.experience.total)} total XP
                      </span>
                    )}
                    {player.inventory !== undefined && (
                      <RosterInventory
                        player={participant.name}
                        items={player.inventory}
                      />
                    )}
                  </th>
                  {columns.map(({ key }) => (
                    <td key={key} className="px-1 py-2 text-right tabular-nums">
                      {formatRosterStat(key, player[key]) ?? (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">Unavailable</span>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </div>
  );
});

function formatRosterStat(
  key: (typeof statColumns)[number]["key"],
  value: number | null | undefined,
) {
  return key === "gold" && hasRosterStat(value)
    ? goldNumber.format(Math.floor(value))
    : value;
}

function hasRosterStat(value: number | null | undefined) {
  return value !== null && value !== undefined;
}
