import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays,
  addMonths,
  displayDate,
  endOfWeek,
  startOfWeek,
  type CalendarDay,
} from "./dates.ts";
import { dueFullLabel } from "./due-display.ts";

const monthTitle = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: "long" });

const firstOfMonth = (day: CalendarDay) => `${day.slice(0, 8)}01`;
const sameMonth = (a: CalendarDay, b: CalendarDay) =>
  a.slice(0, 7) === b.slice(0, 7);

/** The weeks shown for a month: Monday first, always six of them. */
export function monthWeeks(month: CalendarDay): CalendarDay[][] {
  const start = startOfWeek(firstOfMonth(month));
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_unused, day) => addDays(start, week * 7 + day)),
  );
}

/** Where a calendar key moves the focused day, or undefined for other keys. */
export function calendarKey(
  key: string,
  shift: boolean,
  focused: CalendarDay,
): CalendarDay | undefined {
  switch (key) {
    case "ArrowLeft": {
      return addDays(focused, -1);
    }
    case "ArrowRight": {
      return addDays(focused, 1);
    }
    case "ArrowUp": {
      return addDays(focused, -7);
    }
    case "ArrowDown": {
      return addDays(focused, 7);
    }
    case "Home": {
      return startOfWeek(focused);
    }
    case "End": {
      return endOfWeek(focused);
    }
    case "PageUp": {
      return addMonths(focused, shift ? -12 : -1);
    }
    case "PageDown": {
      return addMonths(focused, shift ? 12 : 1);
    }
  }
  return undefined;
}

/**
 * A month as the date picker dialog pattern has it: a grid with one tab
 * stop, arrow keys between days, Page Up and Down between months, Enter or
 * Space to choose. Today is marked; the chosen day is selected.
 */
export function MonthCalendar({
  value,
  today,
  onPick,
}: {
  value: CalendarDay | null;
  today: CalendarDay;
  onPick: (day: CalendarDay) => void;
}) {
  const id = useId();
  const [focused, setFocused] = useState(value ?? today);
  // Focus follows the keyboard, not a render caused by anything else.
  const moving = useRef(false);
  const weeks = monthWeeks(focused);
  // A new month slides in from the side it came from; the first one does not.
  const month = firstOfMonth(focused);
  const [shownMonth, setShownMonth] = useState(month);
  const [shift, setShift] = useState<"next" | "previous">();
  if (month !== shownMonth) {
    setShift(month > shownMonth ? "next" : "previous");
    setShownMonth(month);
  }
  const header = weeks[0] ?? [];
  const move = (next: CalendarDay) => {
    moving.current = true;
    setFocused(next);
  };
  function keydown(event: KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPick(focused);
      return;
    }
    const next = calendarKey(event.key, event.shiftKey, focused);
    if (next !== undefined) {
      event.preventDefault();
      move(next);
    }
  }
  return (
    <div className="calendar">
      <div className="calendar-header">
        <button
          type="button"
          className="icon-button"
          aria-label="Previous month"
          onClick={() => {
            setFocused(addMonths(focused, -1));
          }}
        >
          <ChevronLeft size={15} />
        </button>
        <h3 id={`${id}-title`} className="calendar-title" aria-live="polite">
          {monthTitle.format(displayDate(firstOfMonth(focused)))}
        </h3>
        <button
          type="button"
          className="icon-button"
          aria-label="Next month"
          onClick={() => {
            setFocused(addMonths(focused, 1));
          }}
        >
          <ChevronRight size={15} />
        </button>
      </div>
      <table
        className="calendar-grid"
        role="grid"
        aria-labelledby={`${id}-title`}
        onKeyDown={keydown}
      >
        <thead>
          <tr>
            {header.map((day) => (
              <th
                key={day}
                scope="col"
                abbr={weekdayLong.format(displayDate(day))}
              >
                {weekdayShort.format(displayDate(day)).slice(0, 2)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody key={month} data-shift={shift}>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => (
                <td
                  key={day}
                  role="gridcell"
                  ref={(cell) => {
                    if (cell !== null && day === focused && moving.current) {
                      moving.current = false;
                      cell.focus();
                    }
                  }}
                  tabIndex={day === focused ? 0 : -1}
                  aria-selected={day === value}
                  aria-current={day === today ? "date" : undefined}
                  aria-label={dueFullLabel(day)}
                  data-outside={sameMonth(day, focused) ? undefined : ""}
                  onClick={() => {
                    setFocused(day);
                    onPick(day);
                  }}
                >
                  {Number(day.slice(8))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
