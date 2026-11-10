const fullDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "full",
  timeStyle: "short",
});
const mediumDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const mediumDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const relativeLong = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});
const relativeNarrow = new Intl.RelativeTimeFormat(undefined, {
  numeric: "always",
  style: "narrow",
});

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const steps = [
  { unit: "minute", size: minute, until: hour },
  { unit: "hour", size: hour, until: day },
  { unit: "day", size: day, until: 7 * day },
  { unit: "week", size: 7 * day, until: 30 * day },
  { unit: "month", size: 30 * day, until: 365 * day },
  { unit: "year", size: 365 * day, until: Number.POSITIVE_INFINITY },
] as const;

function formatRelative(
  date: Date,
  now: number,
  style: "long" | "narrow" = "long",
) {
  const elapsed = date.getTime() - now;
  const distance = Math.abs(elapsed);
  if (distance < minute) {
    return "just now";
  }
  const step = steps.find(({ until }) => distance < until);
  if (step === undefined) {
    throw new Error("Relative time has no matching unit");
  }
  return (style === "long" ? relativeLong : relativeNarrow).format(
    Math.trunc(elapsed / step.size),
    step.unit,
  );
}

/** A relative timestamp whose tooltip and machine value carry the exact time. */
export function RelativeTime({
  value,
  style = "long",
  className,
}: {
  value: string;
  style?: "long" | "narrow";
  className?: string;
}) {
  const date = new Date(value);
  return (
    <time
      className={className}
      dateTime={value}
      title={fullDateTime.format(date)}
    >
      {formatRelative(date, Date.now(), style)}
    </time>
  );
}

/** A localized calendar date, optionally with the time of day. */
export function AbsoluteTime({
  value,
  withTime = false,
}: {
  value: string;
  withTime?: boolean;
}) {
  const date = new Date(value);
  return (
    <time dateTime={value} title={fullDateTime.format(date)}>
      {(withTime ? mediumDateTime : mediumDate).format(date)}
    </time>
  );
}
