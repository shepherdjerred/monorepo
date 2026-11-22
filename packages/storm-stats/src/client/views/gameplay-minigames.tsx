import { Swords, Trophy } from "lucide-react";
import type { GameplayOverviewResponse } from "@shepherdjerred/storm-stats/shared/gameplay-contract.ts";
import {
  formatInt,
  formatKdr,
  formatTitleIdentifier,
} from "@shepherdjerred/storm-stats/client/format.ts";
import type { ColumnAccessor } from "@shepherdjerred/storm-stats/client/sort.ts";
import {
  PlayerIdentityLink,
  PlayerRowHeader,
} from "@shepherdjerred/storm-stats/client/components/brand.tsx";
import {
  ResponsiveTable,
  SortableTh,
  useClientTableSort,
} from "@shepherdjerred/storm-stats/client/components/sortable-table.tsx";

type RwfRow = GameplayOverviewResponse["rwfTop"][number];
type ArenaRow = GameplayOverviewResponse["arenaTop"][number];
type QuestRow = GameplayOverviewResponse["questsTop"][number];

const RWF_ACCESSORS: Readonly<
  Record<"name" | "wins" | "matches" | "kills", ColumnAccessor<RwfRow>>
> = {
  name: { kind: "text", getValue: (row) => row.name },
  wins: { kind: "number", getValue: (row) => row.wins },
  matches: { kind: "number", getValue: (row) => row.matches },
  kills: { kind: "number", getValue: (row) => row.kills },
};

const ARENA_ACCESSORS: Readonly<
  Record<"arena" | "name" | "bestWave", ColumnAccessor<ArenaRow>>
> = {
  arena: { kind: "text", getValue: (row) => row.arena },
  name: { kind: "text", getValue: (row) => row.name },
  bestWave: { kind: "number", getValue: (row) => row.bestWave },
};

const QUEST_ACCESSORS: Readonly<
  Record<"name" | "questsCompleted" | "powerLevel", ColumnAccessor<QuestRow>>
> = {
  name: { kind: "text", getValue: (row) => row.name },
  questsCompleted: { kind: "number", getValue: (row) => row.questsCompleted },
  powerLevel: { kind: "number", getValue: (row) => row.powerLevel },
};

export function RwfLeaderboardCard({
  rows,
}: {
  readonly rows: readonly RwfRow[];
}) {
  const { sortedRows, headerProps } = useClientTableSort({
    rows,
    initial: { column: "wins", direction: "descending" },
    accessors: RWF_ACCESSORS,
    labels: {
      name: "Player",
      wins: "Wins",
      matches: "Matches",
      kills: "Kills",
    },
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>
          <Swords
            size={17}
            aria-hidden="true"
            style={{ verticalAlign: "-3px" }}
          />{" "}
          Search &amp; Destroy (RWF)
        </h2>
      </div>
      {sortedRows.length === 0 ? (
        <p className="panel-subtitle">No RWF career records yet.</p>
      ) : (
        <ResponsiveTable caption="Search and Destroy RWF leaderboard" compact>
          <thead>
            <tr>
              <SortableTh label="Player" {...headerProps("name")} />
              <SortableTh label="Wins" numeric {...headerProps("wins")} />
              <SortableTh label="Matches" numeric {...headerProps("matches")} />
              <SortableTh label="Kills" numeric {...headerProps("kills")} />
              <th scope="col" className="num-col">
                K/D
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.uuid}>
                <PlayerRowHeader uuid={row.uuid} name={row.name} />
                <td data-label="Wins" className="num-col">
                  <strong>{formatInt(row.wins)}</strong>
                </td>
                <td data-label="Matches" className="num-col">
                  {formatInt(row.matches)} ({formatInt(row.losses)}L)
                </td>
                <td data-label="Kills" className="num-col">
                  {formatInt(row.kills)}
                </td>
                <td data-label="K/D" className="num-col mono">
                  {formatKdr(row.kills, row.deaths)}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      )}
    </div>
  );
}

export function MobArenaCard({ rows }: { readonly rows: readonly ArenaRow[] }) {
  const { sortedRows, headerProps } = useClientTableSort({
    rows,
    initial: { column: "bestWave", direction: "descending" },
    accessors: ARENA_ACCESSORS,
    labels: { arena: "Arena", name: "Champion", bestWave: "Best Wave" },
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>
          <Trophy
            size={17}
            aria-hidden="true"
            style={{ verticalAlign: "-3px" }}
          />{" "}
          Mob Arena Best Wave Records
        </h2>
      </div>
      {sortedRows.length === 0 ? (
        <p className="panel-subtitle">No Mob Arena wave records yet.</p>
      ) : (
        <ResponsiveTable caption="Mob Arena best wave records" compact>
          <thead>
            <tr>
              <SortableTh label="Arena" {...headerProps("arena")} />
              <SortableTh label="Champion" {...headerProps("name")} />
              <SortableTh
                label="Best Wave"
                numeric
                {...headerProps("bestWave")}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={`${row.arena}-${row.uuid}`}>
                <th scope="row">{formatTitleIdentifier(row.arena)}</th>
                <td data-label="Champion">
                  <PlayerIdentityLink uuid={row.uuid} name={row.name} />
                </td>
                <td data-label="Best Wave" className="num-col">
                  <span className="pill pill-active">
                    Wave {formatInt(row.bestWave)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      )}
    </div>
  );
}

export function QuestsCard({ rows }: { readonly rows: readonly QuestRow[] }) {
  const { sortedRows, headerProps } = useClientTableSort({
    rows,
    initial: { column: "questsCompleted", direction: "descending" },
    accessors: QUEST_ACCESSORS,
    labels: {
      name: "Player",
      questsCompleted: "Quests Completed",
      powerLevel: "Power Level",
    },
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Top Quest Completions</h2>
      </div>
      {sortedRows.length === 0 ? (
        <p className="panel-subtitle">No quest completions recorded yet.</p>
      ) : (
        <ResponsiveTable caption="Top quest completions leaderboard" compact>
          <thead>
            <tr>
              <SortableTh label="Player" {...headerProps("name")} />
              <SortableTh
                label="Quests Completed"
                numeric
                {...headerProps("questsCompleted")}
              />
              <SortableTh
                label="Power Level"
                numeric
                {...headerProps("powerLevel")}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.uuid}>
                <PlayerRowHeader uuid={row.uuid} name={row.name} />
                <td data-label="Quests Completed" className="num-col">
                  <strong>{formatInt(row.questsCompleted)}</strong>
                </td>
                <td data-label="Power Level" className="num-col">
                  {formatInt(row.powerLevel)}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      )}
    </div>
  );
}
