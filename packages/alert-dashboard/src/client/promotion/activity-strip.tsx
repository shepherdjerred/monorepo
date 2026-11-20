import { Temporal } from "@js-temporal/polyfill";
import type { PromotionSourceActivity } from "@shepherdjerred/ops-model/promotion/model.ts";

type Day = PromotionSourceActivity["days"][number];

const count = (n: number, one: string, many: string) =>
  `${String(n)} ${n === 1 ? one : many}`;

function dayClass(day: Day, retained: boolean) {
  const classes = ["p-day"];
  if (day.posts > 0)
    classes.push(`p-day-post-${String(Math.min(day.posts, 3))}`);
  if (day.failures > 0) classes.push("p-day-fail");
  if (day.posts + day.failures === 0)
    classes.push(
      day.noAction > 0 ? "p-day-idle" : retained ? "p-day-none" : "p-day-gap",
    );
  return classes.join(" ");
}

function dayDetail(day: Day, retained: boolean) {
  const parts = [
    day.posts > 0 ? count(day.posts, "post", "posts") : null,
    day.failures > 0 ? count(day.failures, "failed run", "failed runs") : null,
    day.noAction > 0
      ? count(day.noAction, "run posted nothing", "runs posted nothing")
      : null,
  ].filter((part) => part !== null);
  if (parts.length > 0) return parts.join(", ");
  return retained ? "No activity" : "No run records kept";
}

function summary(days: Day[]) {
  const total = (key: keyof Day) => days.reduce((n, day) => n + day[key], 0);
  const posts = total("posts"),
    failures = total("failures"),
    noAction = total("noAction");
  if (posts + failures + noAction === 0) return "No activity";
  return [
    count(posts, "post", "posts"),
    failures > 0 ? `${String(failures)} failed` : null,
    noAction > 0 ? `${String(noAction)} posted nothing` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/** One cell per Pacific day. Fill means a confirmed post; a heavy outline means a failed run. */
export function ActivityStrip({
  activity,
  name,
  onHistory,
}: {
  activity: PromotionSourceActivity | undefined;
  name: string;
  onHistory: () => void;
}) {
  if (activity === undefined)
    return <span className="p-muted">Unavailable</span>;
  const start = Temporal.PlainDate.from(activity.startDay);
  const retainedFrom =
    activity.runDetailFrom === null
      ? null
      : Temporal.PlainDate.from(activity.runDetailFrom);
  return (
    <a className="p-activity" href="#promotion-history" onClick={onHistory}>
      <span className="p-activity-days" aria-hidden="true">
        {activity.days.map((day, index) => {
          const date = start.add({ days: index });
          const retained =
            retainedFrom === null ||
            Temporal.PlainDate.compare(date, retainedFrom) >= 0;
          return (
            <span
              key={date.toString()}
              className={dayClass(day, retained)}
              title={`${date.toLocaleString("en-US", { month: "short", day: "numeric" })}: ${dayDetail(day, retained)}`}
            />
          );
        })}
      </span>
      <span className="sr-only">
        {name}, last {activity.days.length} days:{" "}
      </span>
      <span className="p-activity-summary">{summary(activity.days)}</span>
      <span className="sr-only">. View history</span>
    </a>
  );
}

export function ActivityLegend() {
  return (
    <p className="p-activity-legend p-muted">
      <span>Daily activity, Pacific:</span>
      <span>
        <i className="p-day p-day-post-1" aria-hidden="true" />
        <i className="p-day p-day-post-3" aria-hidden="true" /> posted, darker
        for more
      </span>
      <span>
        <i className="p-day p-day-fail" aria-hidden="true" /> failed run
      </span>
      <span>
        <i className="p-day p-day-idle" aria-hidden="true" /> ran, posted
        nothing
      </span>
      <span>
        <i className="p-day p-day-none" aria-hidden="true" /> nothing
      </span>
      <span>
        <i className="p-day p-day-gap" aria-hidden="true" /> no run records kept
      </span>
    </p>
  );
}
