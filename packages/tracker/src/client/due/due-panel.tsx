import { useId, useState, type Ref } from "react";
import { CalendarX2 } from "lucide-react";
import { displayDate, quickChoices, type CalendarDay } from "./dates.ts";
import { dueFullLabel } from "./due-display.ts";
import { parseDue } from "./parse-due.ts";
import { MonthCalendar } from "./calendar.tsx";
import { isComposing } from "#client/ui/ime.ts";

const weekdayShort = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

/**
 * What a due date picker holds: a field that reads dates written in words,
 * the usual choices, and a month to pick from. Used by the popover, and by
 * the filter popover for "Due before…".
 */
export function DuePanel({
  value,
  today,
  onPick,
  clearable,
  label,
  inputRef,
  autoFocus = false,
}: {
  value: CalendarDay | null;
  today: CalendarDay;
  /** A chosen day, or null to clear the date. */
  onPick: (day: CalendarDay | null) => void;
  clearable: boolean;
  /** The accessible name of the text field. */
  label: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Shown in place of other content, as the filter's "Due before…" is. */
  autoFocus?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const parsed = parseDue(text, today, navigator.language);
  const typed = text.trim() !== "";
  return (
    <div className="due-panel">
      <form
        className="due-input"
        onSubmit={(event) => {
          event.preventDefault();
          if (parsed !== undefined) {
            onPick(parsed);
          }
        }}
      >
        <input
          ref={inputRef}
          aria-label={label}
          aria-describedby={`${id}-preview`}
          aria-invalid={typed && parsed === undefined}
          placeholder="Try “fri”, “next week”, “jan 15” or “+3d”"
          autoComplete="off"
          autoFocus={autoFocus}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            // The Enter that confirms an IME conversion does not submit.
            if (event.key === "Enter" && isComposing(event.nativeEvent)) {
              event.preventDefault();
            }
          }}
        />
        <output id={`${id}-preview`} className="due-preview">
          {typed &&
            (parsed === undefined ? (
              <span className="muted">Not a date I know</span>
            ) : (
              <>
                <span>{weekdayShort.format(displayDate(parsed))}</span>
                <span className="sr-only">: {dueFullLabel(parsed)}</span>
                <kbd aria-hidden="true">↵</kbd>
              </>
            ))}
        </output>
      </form>
      <ul className="due-choices" aria-label="Quick choices">
        {quickChoices(today).map((choice) => (
          <li key={choice.id}>
            <button
              type="button"
              className="due-choice"
              aria-pressed={choice.day === value}
              onClick={() => {
                onPick(choice.day);
              }}
            >
              <span>{choice.label}</span>
              <span className="muted">
                {weekdayShort.format(displayDate(choice.day))}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <MonthCalendar value={value} today={today} onPick={onPick} />
      {clearable && value !== null && (
        <button
          type="button"
          className="text-button due-clear"
          onClick={() => {
            onPick(null);
          }}
        >
          <CalendarX2 size={14} aria-hidden="true" />
          Clear due date
        </button>
      )}
    </div>
  );
}
