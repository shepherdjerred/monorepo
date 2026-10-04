export function CalendarTime({ time }: { time: number }) {
  const date = new Date(time);
  return (
    <time
      dateTime={date.toISOString()}
      title={date.toLocaleString(undefined, { hour12: false })}
    >
      {date.toLocaleDateString()}{" "}
      {date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })}
    </time>
  );
}

export function Attribution({
  requester,
  queuedAt,
}: {
  requester?: { id: string; name: string } | undefined;
  queuedAt?: number | null | undefined;
}) {
  if (requester === undefined) return null;
  return (
    <p className="attribution">
      Added by {requester.name} ·{" "}
      {queuedAt == null ? "Time unknown" : <CalendarTime time={queuedAt} />}
    </p>
  );
}
