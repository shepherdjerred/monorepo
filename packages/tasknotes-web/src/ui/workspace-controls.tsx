import type { ReactNode } from "react";
import { formatMonthDay, type CivilDay } from "#workspace/civil-day.ts";
import { Icon } from "./icons.tsx";
import { WorkspaceLink } from "./sidebar.tsx";
import type { WorkspaceView } from "#workspace/workspace.ts";

export function WeekStrip(props: {
  view: WorkspaceView;
  today: CivilDay;
  upcomingOffset: number;
  onUpcomingOffset: (offset: number) => void;
  upcomingDay?: CivilDay;
  upcomingDayHref?: (day: CivilDay) => string;
  onUpcomingDay?: (day: CivilDay) => void;
}) {
  if (props.view.week.length === 0) return null;
  const firstDay = props.view.week[0];
  const lastDay = props.view.week.at(-1);
  return (
    <section className="week-strip" aria-label="Upcoming schedule">
      <div className="week-nav">
        {firstDay === undefined || lastDay === undefined ? null : (
          <h2>
            {formatMonthDay(firstDay.civilDate)} –{" "}
            {formatMonthDay(lastDay.civilDate)}
          </h2>
        )}
        <div className="week-controls">
          <button
            type="button"
            className="icon-button"
            aria-label="Previous week"
            disabled={props.upcomingOffset === 0}
            onClick={() => {
              props.onUpcomingOffset(Math.max(0, props.upcomingOffset - 7));
            }}
          >
            <Icon name="chevron-left" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Next week"
            onClick={() => {
              props.onUpcomingOffset(props.upcomingOffset + 7);
            }}
          >
            <Icon name="chevron-right" />
          </button>
        </div>
      </div>
      <nav className="week" aria-label="Upcoming days">
        {props.view.week.map((day) => (
          <a
            key={day.civilDate}
            href={
              props.upcomingDayHref?.(day.civilDate) ?? `#day-${day.civilDate}`
            }
            className={day.taskCount > 0 ? "has-tasks" : undefined}
            aria-current={
              day.civilDate === (props.upcomingDay ?? props.today)
                ? "date"
                : undefined
            }
            onClick={
              props.onUpcomingDay === undefined
                ? undefined
                : (event) => {
                    if (
                      event.altKey ||
                      event.ctrlKey ||
                      event.metaKey ||
                      event.shiftKey
                    )
                      return;
                    event.preventDefault();
                    props.onUpcomingDay?.(day.civilDate);
                    document
                      .querySelector(`#day-${CSS.escape(day.civilDate)}`)
                      ?.scrollIntoView({ block: "nearest" });
                  }
            }
          >
            <span>{day.weekdayShort}</span>
            <span className="day-number">{day.dayNumber}</span>
            <span className="day-dot" aria-hidden="true" />
            <span className="visually-hidden">, {day.taskCount} tasks</span>
          </a>
        ))}
      </nav>
    </section>
  );
}

export function WorkspaceTools(props: {
  showBrowse: boolean;
  browseHref?: string | undefined;
  onBrowse: () => void;
  onRefresh: () => void;
  showSync: boolean;
  settingsAction?: ReactNode;
}) {
  return (
    <div className="workspace-tools">
      {props.showBrowse ? (
        <WorkspaceLink
          className="browse-back"
          href={props.browseHref}
          onActivate={props.onBrowse}
        >
          <Icon name="chevron-left" />
          Browse
        </WorkspaceLink>
      ) : null}
      <div className="workspace-tool-actions">
        {props.showSync ? (
          <button
            type="button"
            className="sync-button"
            onClick={props.onRefresh}
          >
            <Icon name="sync" />
            <span>Sync</span>
          </button>
        ) : null}
        {props.settingsAction}
      </div>
    </div>
  );
}
