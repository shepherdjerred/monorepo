import type { ReactNode } from "react";
import type { GameEvent } from "@arcade/common/telemetry.ts";

export function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Activity({
  events,
}: {
  readonly events: readonly GameEvent[];
}) {
  return (
    <Panel
      title="Around the arcade"
      aside={<span className="eyebrow">LIVE ACTIVITY</span>}
    >
      {events.length === 0 ? (
        <p className="empty">The next story starts when you play.</p>
      ) : (
        <ol className="activity">
          {events.toReversed().map((event) => (
            <li key={event.id}>
              <time dateTime={event.at}>
                {new Date(event.at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
              <div>
                <strong>{event.title}</strong>
                <p>{event.text}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: ReactNode;
}) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function duration(milliseconds: number | null): string {
  if (milliseconds === null) return "—";
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = ((milliseconds % 60_000) / 1000).toFixed(3).padStart(6, "0");
  return `${String(minutes)}:${seconds}`;
}
