import type { CombatFeedRow } from "@shepherdjerred/storm-stats/shared/contract.ts";
import {
  formatCombatKind,
  formatDateTime,
  formatRelativeTime,
  formatTitleIdentifier,
  formatWorldLabel,
} from "@shepherdjerred/storm-stats/client/format.ts";
import { PlayerIdentityLink } from "./brand.tsx";
import { ResponsiveTable } from "./sortable-table.tsx";

function combatKindBadgeClass(kind: CombatFeedRow["combatKind"]): string {
  switch (kind) {
    case "pvp":
      return "pill pill-danger";
    case "pve_kill":
      return "pill pill-regular";
    case "pve_death":
      return "pill pill-irregular";
    case "env_death":
      return "pill pill-inactive";
  }
}

function renderAttacker(row: CombatFeedRow) {
  if (row.killerName !== null) {
    return <PlayerIdentityLink uuid={row.killerUuid} name={row.killerName} />;
  }
  if (row.mobType !== null) {
    return (
      <span className="pill pill-irregular">
        {formatTitleIdentifier(row.mobType)}
      </span>
    );
  }
  return <span className="panel-subtitle">Environment</span>;
}

function renderVictim(row: CombatFeedRow) {
  if (row.victimName !== null) {
    return <PlayerIdentityLink uuid={row.victimUuid} name={row.victimName} />;
  }
  return row.mobType === null ? (
    <span className="panel-subtitle">—</span>
  ) : (
    <span>{formatTitleIdentifier(row.mobType)}</span>
  );
}

export function CombatFeedTable({
  rows,
  caption,
}: {
  readonly rows: readonly CombatFeedRow[];
  readonly caption: string;
}) {
  if (rows.length === 0) {
    return <p className="panel-subtitle">No combat events recorded yet.</p>;
  }

  return (
    <ResponsiveTable caption={caption}>
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Type</th>
          <th scope="col">Attacker / Cause</th>
          <th scope="col">Victim / Target</th>
          <th scope="col">Weapon</th>
          <th scope="col">World</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.eventId}>
            <th scope="row">
              <div>{formatRelativeTime(row.occurredAt)}</div>
              <div className="panel-subtitle">
                {formatDateTime(row.occurredAt)}
              </div>
            </th>
            <td data-label="Type">
              <span className={combatKindBadgeClass(row.combatKind)}>
                {formatCombatKind(row.combatKind)}
              </span>
            </td>
            <td data-label="Attacker / Cause">{renderAttacker(row)}</td>
            <td data-label="Victim / Target">{renderVictim(row)}</td>
            <td data-label="Weapon">
              <span className="mono">{formatTitleIdentifier(row.weapon)}</span>
            </td>
            <td data-label="World">{formatWorldLabel(row.world)}</td>
          </tr>
        ))}
      </tbody>
    </ResponsiveTable>
  );
}
