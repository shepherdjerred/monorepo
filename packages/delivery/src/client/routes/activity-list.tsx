import type { ActivityEntry } from "#shared/hub/hub-contract.ts";
import { RelativeTime } from "#client/components/time.tsx";
import { TargetLink } from "#client/components/links.tsx";

export function ActivityList({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return <p className="empty">No activity yet.</p>;
  return (
    <ol className="activity">
      {entries.map((entry) => (
        <li key={entry.id}>
          <RelativeTime value={entry.occurredAt} />
          <span className="activity-action">{entry.action}</span>
          <span className="activity-entity mono">
            {entry.target === null ? (
              entry.entityId
            ) : (
              <TargetLink target={entry.target}>{entry.entityId}</TargetLink>
            )}
          </span>
          <span className="muted">{entry.actor}</span>
        </li>
      ))}
    </ol>
  );
}
