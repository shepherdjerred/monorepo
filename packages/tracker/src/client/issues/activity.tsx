import { Link } from "react-router";
import { ActorChip, Empty } from "#client/ui/ui.tsx";
import type { EventData } from "#client/data/api.ts";
import { RelativeTime } from "#client/ui/time.tsx";

export function ActivityList({
  events,
  detailed = false,
}: {
  events: EventData[];
  detailed?: boolean;
}) {
  if (events.length === 0)
    return (
      <Empty title="No activity yet">
        <p>Changes will appear here as work moves forward.</p>
      </Empty>
    );
  return (
    <ol className="activity-list">
      {events.map((event) => (
        <li key={event.id}>
          <div className="activity-meta">
            <ActorChip actor={event.actor} />
            <span>
              <strong>{event.action.replaceAll("-", " ")}</strong>{" "}
              {event.entityType}{" "}
              {event.issueIdentifier !== null && (
                <Link to={`/issues/${event.issueIdentifier}`}>
                  {event.issueIdentifier}
                </Link>
              )}
            </span>
            <RelativeTime value={event.occurredAt} />
          </div>
          {detailed && (
            <details>
              <summary>View changes</summary>
              <pre>{JSON.stringify(event.changes, null, 2)}</pre>
              {event.rawSourcePayload !== null && (
                <details>
                  <summary>Original source record</summary>
                  <pre>{JSON.stringify(event.rawSourcePayload, null, 2)}</pre>
                </details>
              )}
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
