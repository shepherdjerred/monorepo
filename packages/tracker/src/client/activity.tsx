import { Link } from "react-router";
import { ActorChip, Empty } from "./ui.tsx";
import type { EventData } from "./api.ts";

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
            <time
              dateTime={event.occurredAt}
              title={new Date(event.occurredAt).toLocaleString()}
            >
              {new Date(event.occurredAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </time>
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
