import type { LucideIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { StatusGlyph } from "@shepherdjerred/console-ui/components/status-glyph.tsx";
import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

export type TimelineItem = {
  readonly id: string;
  /** A `Date` or an ISO-8601 string. */
  readonly when: Date | string;
  /** The visible time; the time of day (or date and time) in Pacific by default. */
  readonly whenText?: string | undefined;
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  /** Draws the item's marker as this severity's glyph. */
  readonly severity?: Severity | undefined;
  /** Replaces the marker's glyph; coloured by `severity` when given. */
  readonly icon?: LucideIcon | undefined;
  /** The word read for the marker ("Deployed"); the severity's name by default. */
  readonly iconLabel?: string | undefined;
  /** Who did it, drawn before the meta line. */
  readonly actor?: ReactNode;
  readonly meta?: ReactNode;
};

export type TimelineProps = {
  readonly items: readonly TimelineItem[];
  /** Accessible name of the list ("Changes", "Deployment steps"). */
  readonly label: string;
  /** Splits the list under "Today", "Yesterday", "Tue, Nov 24" headings. */
  readonly groupByDay?: boolean | undefined;
  /** 28px items with the detail on the title line, for dense feeds. */
  readonly density?: "default" | "compact" | undefined;
  /** IANA zone for times and days; Pacific by default. */
  readonly timeZone?: string | undefined;
  /** "Today" is relative to this (a Date or ISO string); the current time by default. */
  readonly now?: Date | string | undefined;
  readonly dayHeadingLevel?: 3 | 4 | undefined;
  readonly emptyMessage?: string | undefined;
};

export const DEFAULT_TIME_ZONE = "America/Los_Angeles";

export function toDate(when: Date | string): Date {
  return typeof when === "string" ? new Date(when) : when;
}

/** `YYYY-MM-DD` of `date` in `timeZone`, for grouping by day. */
export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** "Today", "Yesterday", or "Tue, Nov 24" (with the year when it differs). */
export function dayLabel(date: Date, now: Date, timeZone: string): string {
  const day = dayKey(date, timeZone);
  if (day === dayKey(now, timeZone)) {
    return "Today";
  }
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (day === dayKey(yesterday, timeZone)) {
    return "Yesterday";
  }
  const sameYear = day.slice(0, 4) === dayKey(now, timeZone).slice(0, 4);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

function clock(date: Date, timeZone: string, seconds: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    hourCycle: "h23",
  }).format(date);
}

/**
 * "14:02", or "Nov 24, 14:02" when the list is not split by day. The date
 * and clock are joined here, not by ICU, whose joining word varies.
 */
export function timeText(
  date: Date,
  timeZone: string,
  withDate: boolean,
): string {
  const time = clock(date, timeZone, false);
  if (!withDate) {
    return time;
  }
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(date);
  return `${day}, ${time}`;
}

/** The exact time shown on hover: "Tue, Nov 24, 2026, 14:02:09 PST". */
export function exactText(date: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
  const zone =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? timeZone;
  return `${day}, ${clock(date, timeZone, true)} ${zone}`;
}

type Day = { readonly key: string; readonly items: TimelineItem[] };

function byDay(items: readonly TimelineItem[], timeZone: string): Day[] {
  const days: Day[] = [];
  for (const item of items) {
    const key = dayKey(toDate(item.when), timeZone);
    const last = days.at(-1);
    if (last?.key === key) {
      last.items.push(item);
    } else {
      days.push({ key, items: [item] });
    }
  }
  return days;
}

function Marker({ item }: { readonly item: TimelineItem }): React.JSX.Element {
  if (item.severity !== undefined) {
    return (
      <StatusGlyph
        severity={item.severity}
        hideLabel
        {...(item.icon === undefined ? {} : { icon: item.icon })}
        {...(item.iconLabel === undefined ? {} : { label: item.iconLabel })}
      />
    );
  }
  if (item.icon !== undefined) {
    const Icon = item.icon;
    return (
      <span className="ui-timeline-icon">
        <Icon aria-hidden="true" />
        {item.iconLabel === undefined ? null : (
          <span className="ui-sr-only">{item.iconLabel}</span>
        )}
      </span>
    );
  }
  return <span className="ui-timeline-dot" aria-hidden="true" />;
}

function Entry({
  item,
  timeZone,
  withDate,
}: {
  readonly item: TimelineItem;
  readonly timeZone: string;
  readonly withDate: boolean;
}): React.JSX.Element {
  const date = toDate(item.when);
  const hasMeta = item.actor !== undefined || item.meta !== undefined;
  return (
    <li className="ui-timeline-item">
      <time
        className="ui-timeline-time"
        dateTime={date.toISOString()}
        title={exactText(date, timeZone)}
      >
        {item.whenText ?? timeText(date, timeZone, withDate)}
      </time>
      <span className="ui-timeline-marker">
        <Marker item={item} />
      </span>
      <div className="ui-timeline-body">
        <div className="ui-timeline-title">{item.title}</div>
        {item.detail === undefined ? null : (
          <div className="ui-timeline-detail">{item.detail}</div>
        )}
        {hasMeta ? (
          <div className="ui-timeline-meta">
            {item.actor === undefined ? null : (
              <span className="ui-timeline-actor">{item.actor}</span>
            )}
            {item.meta}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * An ordered event list for activity feeds, change logs and step
 * timelines: a mono time column (exact time on hover), a marker on a
 * hairline rail, then the title, detail and actor. Items render in the
 * order given; sort them first.
 */
export function Timeline({
  items,
  label,
  groupByDay = false,
  density = "default",
  timeZone = DEFAULT_TIME_ZONE,
  now = new Date(),
  dayHeadingLevel = 3,
  emptyMessage = "Nothing has happened yet.",
}: TimelineProps): React.JSX.Element {
  if (items.length === 0) {
    return <p className="ui-timeline-empty">{emptyMessage}</p>;
  }
  if (!groupByDay) {
    return (
      <ol className="ui-timeline" data-density={density} aria-label={label}>
        {items.map((item) => (
          <Entry key={item.id} item={item} timeZone={timeZone} withDate />
        ))}
      </ol>
    );
  }
  const Heading = dayHeadingLevel === 3 ? "h3" : "h4";
  return (
    <div className="ui-timeline-days" role="group" aria-label={label}>
      {byDay(items, timeZone).map((day) => {
        const first = day.items[0];
        const heading =
          first === undefined
            ? day.key
            : dayLabel(toDate(first.when), toDate(now), timeZone);
        return (
          <Fragment key={day.key}>
            <Heading className="ui-timeline-day">{heading}</Heading>
            <ol
              className="ui-timeline"
              data-density={density}
              aria-label={`${label}, ${heading}`}
            >
              {day.items.map((item) => (
                <Entry
                  key={item.id}
                  item={item}
                  timeZone={timeZone}
                  withDate={false}
                />
              ))}
            </ol>
          </Fragment>
        );
      })}
    </div>
  );
}
