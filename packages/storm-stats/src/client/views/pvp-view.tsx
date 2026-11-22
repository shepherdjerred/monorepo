import { Skull, Swords, Trophy, Users } from "lucide-react";
import type { WeaponStat } from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  PvpOverviewResponseSchema,
  type MobCombatRow,
  type PvpLeaderRow,
  type PvpOverviewResponse,
} from "@shepherdjerred/storm-stats/shared/gameplay-contract.ts";
import { useApiQuery } from "@shepherdjerred/storm-stats/client/api.ts";
import {
  formatDecimal,
  formatInt,
  formatPercent,
  formatTitleIdentifier,
} from "@shepherdjerred/storm-stats/client/format.ts";
import type { ColumnAccessor } from "@shepherdjerred/storm-stats/client/sort.ts";
import {
  PlayerRowHeader,
  renderQueryGate,
} from "@shepherdjerred/storm-stats/client/components/brand.tsx";
import { ShareBreakdownPanel } from "@shepherdjerred/storm-stats/client/components/charts-matrix.tsx";
import { CombatFeedTable } from "@shepherdjerred/storm-stats/client/components/combat-feed-table.tsx";
import {
  ResponsiveTable,
  SortableTh,
  useClientTableSort,
} from "@shepherdjerred/storm-stats/client/components/sortable-table.tsx";

type WarriorSortKey = "name" | "kills" | "deaths" | "kdr" | "mobKills";

const WARRIOR_ACCESSORS: Readonly<
  Record<WarriorSortKey, ColumnAccessor<PvpLeaderRow>>
> = {
  name: { kind: "text", getValue: (row) => row.name },
  kills: { kind: "number", getValue: (row) => row.kills },
  deaths: { kind: "number", getValue: (row) => row.deaths },
  kdr: { kind: "number", getValue: (row) => row.kdr },
  mobKills: { kind: "number", getValue: (row) => row.mobKills },
};

const WARRIOR_LABELS: Readonly<Record<WarriorSortKey, string>> = {
  name: "Warrior",
  kills: "PvP Kills",
  deaths: "PvP Deaths",
  kdr: "K/D Ratio",
  mobKills: "Mob Kills",
};

type MobSortKey = "mobType" | "killedByPlayers" | "killedPlayers";

const MOB_ACCESSORS: Readonly<
  Record<MobSortKey, ColumnAccessor<MobCombatRow>>
> = {
  mobType: { kind: "text", getValue: (row) => row.mobType },
  killedByPlayers: { kind: "number", getValue: (row) => row.killedByPlayers },
  killedPlayers: { kind: "number", getValue: (row) => row.killedPlayers },
};

const MOB_LABELS: Readonly<Record<MobSortKey, string>> = {
  mobType: "Mob Type",
  killedByPlayers: "Slain by Players",
  killedPlayers: "Killed Players",
};

type WeaponSortKey = "weapon" | "kills" | "sharePercent";

const WEAPON_ACCESSORS: Readonly<
  Record<WeaponSortKey, ColumnAccessor<WeaponStat>>
> = {
  weapon: { kind: "text", getValue: (row) => row.weapon },
  kills: { kind: "number", getValue: (row) => row.kills },
  sharePercent: { kind: "number", getValue: (row) => row.sharePercent },
};

const WEAPON_LABELS: Readonly<Record<WeaponSortKey, string>> = {
  weapon: "Weapon",
  kills: "Kills",
  sharePercent: "Share",
};

export function PvpView() {
  const query = useApiQuery("/api/v1/pvp", PvpOverviewResponseSchema);

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1 id="page-heading" tabIndex={-1}>
            PvP &amp; PvE Combat
          </h1>
          <p className="page-subtitle">
            Survival &amp; arena combat leaderboards, deadliest weapons, mob
            encounters, and the latest 100 combat events.
          </p>
        </div>
      </div>

      {renderQueryGate(query, "Loading combat telemetry…", (data) => (
        <PvpContent data={data} />
      ))}
    </div>
  );
}

function PvpContent({ data }: { readonly data: PvpOverviewResponse }) {
  const { kpis } = data;

  return (
    <div className="stack-lg">
      <section aria-label="Combat summary metrics" className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">
            <span>Total PvP Kills</span>
            <Swords size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatInt(kpis.totalPvpKills)}</div>
          <div className="kpi-detail">
            Deadliest weapon:{" "}
            <strong>
              {kpis.deadliestWeapon === null
                ? "—"
                : formatTitleIdentifier(kpis.deadliestWeapon)}
            </strong>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Total Mob Kills</span>
            <Trophy size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatInt(kpis.totalMobKills)}</div>
          <div className="kpi-detail">Hostile &amp; boss mobs defeated</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Total Player Deaths</span>
            <Skull size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatInt(kpis.totalPlayerDeaths)}</div>
          <div className="kpi-detail">
            Deadliest mob:{" "}
            <strong>
              {kpis.deadliestMob === null
                ? "—"
                : formatTitleIdentifier(kpis.deadliestMob)}
            </strong>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Unique Combatants</span>
            <Users size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatInt(kpis.uniqueCombatants)}</div>
          <div className="kpi-detail">Players with recorded combat events</div>
        </div>
      </section>

      <TopWarriorsPanel warriors={data.topWarriors} />

      <div className="grid-2">
        <WeaponsSection weapons={data.topWeapons} />
        <MobBreakdownSection mobs={data.mobBreakdown} />
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Recent Kills &amp; Combat Feed</h2>
          <span className="panel-subtitle">
            Latest {formatInt(data.recentKills.length)} combat events across The
            Storm
          </span>
        </div>
        <CombatFeedTable
          rows={data.recentKills}
          caption="Recent PvP and PvE combat events"
        />
      </div>
    </div>
  );
}

function TopWarriorsPanel({
  warriors,
}: {
  readonly warriors: readonly PvpLeaderRow[];
}) {
  const { sortedRows, headerProps } = useClientTableSort({
    rows: warriors,
    initial: { column: "kills", direction: "descending" },
    accessors: WARRIOR_ACCESSORS,
    labels: WARRIOR_LABELS,
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Top PvP Warriors</h2>
        <span className="panel-subtitle">
          Click any column header to sort combatants
        </span>
      </div>
      {sortedRows.length === 0 ? (
        <p className="panel-subtitle">No PvP warriors recorded yet.</p>
      ) : (
        <ResponsiveTable caption="Top PvP warriors leaderboard">
          <thead>
            <tr>
              <SortableTh label="Warrior" {...headerProps("name")} />
              <SortableTh label="PvP Kills" numeric {...headerProps("kills")} />
              <SortableTh
                label="PvP Deaths"
                numeric
                {...headerProps("deaths")}
              />
              <SortableTh label="K/D Ratio" numeric {...headerProps("kdr")} />
              <th scope="col">Top Weapon</th>
              <SortableTh
                label="Mob Kills"
                numeric
                {...headerProps("mobKills")}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.uuid}>
                <PlayerRowHeader uuid={row.uuid} name={row.name} />
                <td data-label="PvP Kills" className="num-col">
                  <strong>{formatInt(row.kills)}</strong>
                </td>
                <td data-label="PvP Deaths" className="num-col">
                  {formatInt(row.deaths)}
                </td>
                <td data-label="K/D Ratio" className="num-col mono">
                  {formatDecimal(row.kdr, 2)}
                </td>
                <td data-label="Top Weapon" className="mono">
                  {row.topWeapon === null
                    ? "—"
                    : formatTitleIdentifier(row.topWeapon)}
                </td>
                <td data-label="Mob Kills" className="num-col">
                  {formatInt(row.mobKills)}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      )}
    </div>
  );
}

function WeaponsSection({
  weapons,
}: {
  readonly weapons: readonly WeaponStat[];
}) {
  const { sortedRows, toggleColumn, directionFor } = useClientTableSort({
    rows: weapons,
    initial: { column: "kills", direction: "descending" },
    accessors: WEAPON_ACCESSORS,
    labels: WEAPON_LABELS,
  });

  return (
    <div className="stack-lg">
      <ShareBreakdownPanel
        title="Top Weapons Share"
        subtitle="Share of fatal PvP blows"
        items={weapons.slice(0, 6).map((item) => ({
          key: item.weapon,
          label: formatTitleIdentifier(item.weapon),
          sharePercent: item.sharePercent,
          detail: `${formatInt(item.kills)} kills`,
        }))}
      />

      {sortedRows.length > 0 ? (
        <ResponsiveTable caption="Top PvP weapons breakdown" compact>
          <thead>
            <tr>
              <SortableTh
                label="Weapon"
                direction={directionFor("weapon")}
                onActivate={() => {
                  toggleColumn("weapon");
                }}
              />
              <SortableTh
                label="Kills"
                numeric
                direction={directionFor("kills")}
                onActivate={() => {
                  toggleColumn("kills");
                }}
              />
              <SortableTh
                label="Share"
                numeric
                direction={directionFor("sharePercent")}
                onActivate={() => {
                  toggleColumn("sharePercent");
                }}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((item) => (
              <tr key={item.weapon}>
                <th scope="row">{formatTitleIdentifier(item.weapon)}</th>
                <td data-label="Kills" className="num-col">
                  {formatInt(item.kills)}
                </td>
                <td data-label="Share" className="num-col">
                  {formatPercent(item.sharePercent, 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      ) : null}
    </div>
  );
}

function MobBreakdownSection({
  mobs,
}: {
  readonly mobs: readonly MobCombatRow[];
}) {
  const { sortedRows, toggleColumn, directionFor } = useClientTableSort({
    rows: mobs,
    initial: { column: "killedByPlayers", direction: "descending" },
    accessors: MOB_ACCESSORS,
    labels: MOB_LABELS,
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Mob Breakdown</h2>
        <span className="panel-subtitle">
          Mobs slain by players vs player fatalities caused
        </span>
      </div>
      {sortedRows.length === 0 ? (
        <p className="panel-subtitle">No mob combat data recorded yet.</p>
      ) : (
        <ResponsiveTable
          caption="Mob kills and player fatalities by mob type"
          compact
        >
          <thead>
            <tr>
              <SortableTh
                label="Mob Type"
                direction={directionFor("mobType")}
                onActivate={() => {
                  toggleColumn("mobType");
                }}
              />
              <SortableTh
                label="Slain by Players"
                numeric
                direction={directionFor("killedByPlayers")}
                onActivate={() => {
                  toggleColumn("killedByPlayers");
                }}
              />
              <SortableTh
                label="Killed Players"
                numeric
                direction={directionFor("killedPlayers")}
                onActivate={() => {
                  toggleColumn("killedPlayers");
                }}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.mobType}>
                <th scope="row">{formatTitleIdentifier(row.mobType)}</th>
                <td data-label="Slain by Players" className="num-col">
                  <strong>{formatInt(row.killedByPlayers)}</strong>
                </td>
                <td data-label="Killed Players" className="num-col">
                  {row.killedPlayers > 0 ? (
                    <span className="pill pill-danger">
                      {formatInt(row.killedPlayers)}
                    </span>
                  ) : (
                    "0"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      )}
    </div>
  );
}
