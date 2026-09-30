import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC, type RouterOutputs } from "#src/lib/query/trpc.ts";

type Overview = RouterOutputs["consumerGuild"]["overview"];
type WindowDays = 30 | 90 | "all";

function PlayerCheckboxes(props: {
  players: Overview["players"];
  selected: number[];
  maximum: number;
  onChange: (ids: number[]) => void;
}) {
  return (
    <div className="grid max-h-52 grid-cols-2 gap-1 overflow-y-auto rounded border p-2 sm:grid-cols-3">
      {props.players.map((player) => (
        <label key={player.id} className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={props.selected.includes(player.id)}
            disabled={
              !props.selected.includes(player.id) &&
              props.selected.length >= props.maximum
            }
            onChange={(event) => {
              props.onChange(
                event.target.checked
                  ? [...props.selected, player.id]
                  : props.selected.filter((id) => id !== player.id),
              );
            }}
          />
          <span className="truncate">{player.alias}</span>
        </label>
      ))}
    </div>
  );
}

function SquadTool(props: { overview: Overview; windowDays: WindowDays }) {
  const [selected, setSelected] = useState<number[]>([]);
  const trpc = useTRPC();
  const squad = useQuery(
    trpc.consumerGuild.squad.queryOptions(
      {
        guildId: props.overview.guild.id,
        windowDays: props.windowDays,
        queuePreset: "standard",
        playerIds: selected,
      },
      {
        enabled: selected.length >= 2 && selected.length <= 5,
        staleTime: 0,
        gcTime: 0,
      },
    ),
  );
  return (
    <section className="space-y-2">
      <h4 className="font-medium">Duo / squad chemistry</h4>
      <p className="text-xs text-scout-subtle">
        Choose 2–5 guild players. This counts matches where all selected players
        appeared on the same team; it does not prove they queued as a party.
      </p>
      <PlayerCheckboxes
        players={props.overview.players}
        selected={selected}
        maximum={5}
        onChange={setSelected}
      />
      {selected.length < 2 ? (
        <p className="text-sm text-scout-subtle">
          Choose at least two players.
        </p>
      ) : squad.isPending || squad.isFetching ? (
        <p className="text-sm text-scout-subtle">Calculating shared games…</p>
      ) : squad.isError ? (
        <p className="text-sm text-scout-danger">
          Could not calculate squad history.
        </p>
      ) : (
        <p className="text-sm">
          {squad.data.wins.toString()}/{squad.data.games.toString()} wins
          together
          {squad.data.lowSample ? " · low sample (fewer than 3 games)" : ""}
        </p>
      )}
    </section>
  );
}

function PoolCoverage(props: { overview: Overview }) {
  const rows = props.overview.insights.coverage;
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.playerId.toString()}:${row.role}`;
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  return (
    <section className="space-y-2">
      <h4 className="font-medium">Role and champion coverage</h4>
      <p className="text-xs text-scout-subtle">
        Observed standard 5v5 picks across this window. Fewer than three games
        is a low sample.
      </p>
      {groups.size === 0 ? (
        <p className="text-sm text-scout-subtle">No standard 5v5 role data.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {[...groups].map(([key, entries]) => {
            const player = props.overview.players.find(
              (candidate) => candidate.id === entries[0]?.playerId,
            );
            const games = entries.reduce((sum, entry) => sum + entry.games, 0);
            return (
              <p key={key} className="rounded border p-2 text-sm">
                <span className="font-medium">
                  {player?.alias ?? "Unknown"} · {entries[0]?.role}
                </span>{" "}
                · {games.toString()} games{games < 3 ? " · low sample" : ""}
                <span className="block text-xs text-scout-subtle">
                  {entries
                    .slice(0, 3)
                    .map(
                      (entry) =>
                        `${entry.champion} (${entry.games.toString()})`,
                    )
                    .join(" · ")}
                </span>
              </p>
            );
          })}
        </div>
      )}
    </section>
  );
}

function BalancerTool(props: { overview: Overview; windowDays: WindowDays }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [priority, setPriority] = useState<"roles" | "strength">("roles");
  const trpc = useTRPC();
  const balance = useQuery(
    trpc.consumerGuild.balance.queryOptions(
      {
        guildId: props.overview.guild.id,
        windowDays: props.windowDays,
        queuePreset: "standard",
        playerIds: selected,
        priority,
      },
      { enabled: selected.length === 10, staleTime: 0, gcTime: 0 },
    ),
  );
  return (
    <section className="space-y-2">
      <h4 className="font-medium">In-house 5v5 balancer</h4>
      <p className="text-xs text-scout-subtle">
        Choose exactly 10 unique players. Strength uses (wins + 5) / (games +
        10) over each player&apos;s latest 20 eligible recorded games in this
        window. Role fit is observed role share.
      </p>
      <PlayerCheckboxes
        players={props.overview.players}
        selected={selected}
        maximum={10}
        onChange={setSelected}
      />
      <label className="text-sm">
        Priority{" "}
        <select
          className="ml-1 rounded border border-scout-border bg-scout-surface p-1"
          value={priority}
          onChange={(event) => {
            setPriority(
              event.target.value === "strength" ? "strength" : "roles",
            );
          }}
        >
          <option value="roles">Roles first</option>
          <option value="strength">Even strength first</option>
        </select>
      </label>
      {selected.length === 10 ? (
        balance.isPending || balance.isFetching ? (
          <p className="text-sm text-scout-subtle">Balancing teams…</p>
        ) : balance.isError ? (
          <p className="text-sm text-scout-danger">
            Could not balance this group.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm">
              Smoothed form gap: {(balance.data.formGap * 100).toFixed(1)}{" "}
              points · total role fit: {balance.data.roleFit.toFixed(2)}
            </p>
            {balance.data.lowDataPlayerIds.length > 0 && (
              <p className="text-xs text-scout-subtle">
                Low-data players:{" "}
                {balance.data.lowDataPlayerIds
                  .map(
                    (id) =>
                      props.overview.players.find((player) => player.id === id)
                        ?.alias ?? "Unknown",
                  )
                  .join(", ")}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {balance.data.teams.map((team, index) => (
                <div key={index} className="rounded border p-3 text-sm">
                  <p className="font-medium">Team {(index + 1).toString()}</p>
                  <ul>
                    {team.assignments.map((assignment) => (
                      <li key={assignment.role}>
                        {assignment.role}:{" "}
                        {props.overview.players.find(
                          (player) => player.id === assignment.playerId,
                        )?.alias ?? "Unknown"}{" "}
                        <span className="text-scout-subtle">
                          ({Math.round(assignment.fit * 100).toString()}%
                          observed)
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )
      ) : (
        <p className="text-sm text-scout-subtle">
          {selected.length.toString()}/10 players selected.
        </p>
      )}
    </section>
  );
}

export function ConsumerGuildTeamTools(props: {
  overview: Overview;
  windowDays: WindowDays;
}) {
  return (
    <div className="space-y-6">
      <p className="text-xs text-scout-subtle">
        Team tools always use recorded standard 5v5 matches, regardless of the
        queue selector above.
      </p>
      <SquadTool overview={props.overview} windowDays={props.windowDays} />
      <PoolCoverage overview={props.overview} />
      <BalancerTool overview={props.overview} windowDays={props.windowDays} />
    </div>
  );
}
