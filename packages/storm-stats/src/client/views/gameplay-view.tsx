import { Coins, Compass, Crown, Sparkles, Swords } from "lucide-react";
import {
  GameplayOverviewResponseSchema,
  type GameplayOverviewResponse,
} from "@shepherdjerred/storm-stats/shared/gameplay-contract.ts";
import { useApiQuery } from "@shepherdjerred/storm-stats/client/api.ts";
import {
  formatInt,
  formatTitleIdentifier,
} from "@shepherdjerred/storm-stats/client/format.ts";
import type { ColumnAccessor } from "@shepherdjerred/storm-stats/client/sort.ts";
import {
  PlayerRowHeader,
  renderQueryGate,
} from "@shepherdjerred/storm-stats/client/components/brand.tsx";
import {
  ResponsiveTable,
  SortableTh,
  useClientTableSort,
} from "@shepherdjerred/storm-stats/client/components/sortable-table.tsx";
import {
  MobArenaCard,
  QuestsCard,
  RwfLeaderboardCard,
} from "./gameplay-minigames.tsx";

type EconomyRow = GameplayOverviewResponse["economyTop"][number];
type TownRow = GameplayOverviewResponse["towns"][number];
type SkillRow = GameplayOverviewResponse["skillsTop"][number];

const ECON_ACCESSORS: Readonly<
  Record<"name" | "coins", ColumnAccessor<EconomyRow>>
> = {
  name: { kind: "text", getValue: (row) => row.name },
  coins: { kind: "number", getValue: (row) => row.coins },
};

const TOWN_ACCESSORS: Readonly<
  Record<"name" | "members" | "claims", ColumnAccessor<TownRow>>
> = {
  name: { kind: "text", getValue: (row) => row.name },
  members: { kind: "number", getValue: (row) => row.members },
  claims: { kind: "number", getValue: (row) => row.claims },
};

const SKILL_ACCESSORS: Readonly<
  Record<"name" | "powerLevel" | "topSkillLevel", ColumnAccessor<SkillRow>>
> = {
  name: { kind: "text", getValue: (row) => row.name },
  powerLevel: { kind: "number", getValue: (row) => row.powerLevel },
  topSkillLevel: { kind: "number", getValue: (row) => row.topSkillLevel },
};

export function GameplayView() {
  const query = useApiQuery("/api/v1/gameplay", GameplayOverviewResponseSchema);

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1 id="page-heading" tabIndex={-1}>
            Storm Gameplay
          </h1>
          <p className="page-subtitle">
            First-party Storm plugin analytics across Economy, Towns, Retro
            Skills, Search &amp; Destroy (RWF), Mob Arena, and Quests.
          </p>
        </div>
      </div>

      {renderQueryGate(
        query,
        "Loading Storm gameplay leaderboards…",
        (data) => (
          <GameplayContent data={data} />
        ),
      )}
    </div>
  );
}

function GameplayContent({
  data,
}: {
  readonly data: GameplayOverviewResponse;
}) {
  const topCoinHolder = data.economyTop[0];
  const topPowerHolder = data.skillsTop[0];
  const topRwfHolder = data.rwfTop[0];

  return (
    <div className="stack-lg">
      <section aria-label="Gameplay highlights" className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">
            <span>Richest Balance</span>
            <Coins size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">
            {topCoinHolder === undefined
              ? "—"
              : `${formatInt(topCoinHolder.coins)} coins`}
          </div>
          <div className="kpi-detail">
            {topCoinHolder === undefined
              ? "No economy snapshots yet"
              : `Held by ${topCoinHolder.name}`}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Active Towns</span>
            <Compass size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">{formatInt(data.towns.length)}</div>
          <div className="kpi-detail">
            {formatInt(data.towns.reduce((sum, town) => sum + town.claims, 0))}{" "}
            claimed chunks total
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Highest Skill Power</span>
            <Sparkles size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">
            {topPowerHolder === undefined
              ? "—"
              : formatInt(topPowerHolder.powerLevel)}
          </div>
          <div className="kpi-detail">
            {topPowerHolder === undefined
              ? "No skill snapshots yet"
              : `${topPowerHolder.name} (${topPowerHolder.topSkill ?? "Balanced"})`}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">
            <span>Search &amp; Destroy Leader</span>
            <Swords size={16} aria-hidden="true" />
          </div>
          <div className="kpi-value">
            {topRwfHolder === undefined
              ? "—"
              : `${formatInt(topRwfHolder.wins)} wins`}
          </div>
          <div className="kpi-detail">
            {topRwfHolder === undefined
              ? "No RWF matches yet"
              : `${topRwfHolder.name} (${formatInt(topRwfHolder.matches)} matches)`}
          </div>
        </div>
      </section>

      <div className="grid-2">
        <EconomyCard rows={data.economyTop} />
        <TownsDirectoryCard rows={data.towns} />
      </div>

      <div className="grid-2">
        <RetroSkillsCard rows={data.skillsTop} />
        <RwfLeaderboardCard rows={data.rwfTop} />
      </div>

      <div className="grid-2">
        <MobArenaCard rows={data.arenaTop} />
        <QuestsCard rows={data.questsTop} />
      </div>
    </div>
  );
}

function EconomyCard({ rows }: { readonly rows: readonly EconomyRow[] }) {
  const { sortedRows, headerProps } = useClientTableSort({
    rows,
    initial: { column: "coins", direction: "descending" },
    accessors: ECON_ACCESSORS,
    labels: { name: "Player", coins: "Coins" },
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>
          <Coins
            size={17}
            aria-hidden="true"
            style={{ verticalAlign: "-3px" }}
          />{" "}
          Economy (Top Coin Balances)
        </h2>
      </div>
      {sortedRows.length === 0 ? (
        <p className="panel-subtitle">No economy balances captured yet.</p>
      ) : (
        <ResponsiveTable caption="Top player coin balances" compact>
          <thead>
            <tr>
              <SortableTh label="Player" {...headerProps("name")} />
              <th scope="col">Town</th>
              <SortableTh label="Coins" numeric {...headerProps("coins")} />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.uuid}>
                <PlayerRowHeader uuid={row.uuid} name={row.name} />
                <td data-label="Town">{row.townName ?? "—"}</td>
                <td data-label="Coins" className="num-col">
                  <span className="pill pill-gold">{formatInt(row.coins)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      )}
    </div>
  );
}

function TownsDirectoryCard({ rows }: { readonly rows: readonly TownRow[] }) {
  const { sortedRows, headerProps } = useClientTableSort({
    rows,
    initial: { column: "members", direction: "descending" },
    accessors: TOWN_ACCESSORS,
    labels: { name: "Town", members: "Residents", claims: "Claimed Chunks" },
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>
          <Crown
            size={17}
            aria-hidden="true"
            style={{ verticalAlign: "-3px" }}
          />{" "}
          Towns Directory
        </h2>
      </div>
      {sortedRows.length === 0 ? (
        <p className="panel-subtitle">No towns registered yet.</p>
      ) : (
        <ResponsiveTable caption="Server towns directory" compact>
          <thead>
            <tr>
              <SortableTh label="Town" {...headerProps("name")} />
              <th scope="col">Kind</th>
              <SortableTh
                label="Residents"
                numeric
                {...headerProps("members")}
              />
              <SortableTh
                label="Claimed Chunks"
                numeric
                {...headerProps("claims")}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td data-label="Kind">
                  <span className="pill pill-neutral">
                    {formatTitleIdentifier(row.kind)}
                  </span>
                </td>
                <td data-label="Residents" className="num-col">
                  {formatInt(row.members)}
                </td>
                <td data-label="Claimed Chunks" className="num-col">
                  {formatInt(row.claims)}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      )}
    </div>
  );
}

function RetroSkillsCard({ rows }: { readonly rows: readonly SkillRow[] }) {
  const { sortedRows, headerProps } = useClientTableSort({
    rows,
    initial: { column: "powerLevel", direction: "descending" },
    accessors: SKILL_ACCESSORS,
    labels: {
      name: "Player",
      powerLevel: "Power Level",
      topSkillLevel: "Signature Level",
    },
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>
          <Sparkles
            size={17}
            aria-hidden="true"
            style={{ verticalAlign: "-3px" }}
          />{" "}
          Retro Skills Power Leaderboard
        </h2>
      </div>
      {sortedRows.length === 0 ? (
        <p className="panel-subtitle">No Retro Skills snapshots yet.</p>
      ) : (
        <ResponsiveTable caption="Retro Skills top power levels" compact>
          <thead>
            <tr>
              <SortableTh label="Player" {...headerProps("name")} />
              <SortableTh
                label="Power Level"
                numeric
                {...headerProps("powerLevel")}
              />
              <th scope="col">Signature Skill</th>
              <SortableTh
                label="Signature Level"
                numeric
                {...headerProps("topSkillLevel")}
              />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.uuid}>
                <PlayerRowHeader uuid={row.uuid} name={row.name} />
                <td data-label="Power Level" className="num-col">
                  <span className="pill pill-purple">
                    {formatInt(row.powerLevel)}
                  </span>
                </td>
                <td data-label="Signature Skill">
                  {row.topSkill === null
                    ? "—"
                    : formatTitleIdentifier(row.topSkill)}
                </td>
                <td data-label="Signature Level" className="num-col">
                  {formatInt(row.topSkillLevel)}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      )}
    </div>
  );
}
