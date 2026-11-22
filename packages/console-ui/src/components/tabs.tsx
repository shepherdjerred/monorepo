import { useRef, type KeyboardEvent } from "react";

export type TabOption<Value extends string> = {
  readonly value: Value;
  readonly label: string;
  readonly count?: number | string;
};

export type TabsProps<Value extends string> = {
  /** Accessible name of the group, e.g. "Show". */
  readonly label: string;
  readonly options: readonly TabOption<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
};

const STEP: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** The option index a key moves the selection to, or undefined to ignore the key. */
export function tabTargetIndex(
  key: string,
  current: number,
  count: number,
): number | undefined {
  const step = STEP[key];
  if (step !== undefined) return (current + step + count) % count;
  if (key === "Home") return 0;
  return key === "End" ? count - 1 : undefined;
}

/**
 * Underlined view tabs for filtering one list. They are a radio group, the
 * pattern the consoles already use for view toggles: one stop in the tab
 * order, arrow keys move the selection, Home and End jump to the ends.
 */
export function Tabs<Value extends string>({
  label,
  options,
  value,
  onChange,
}: TabsProps<Value>): React.JSX.Element {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function select(index: number): void {
    const option = options[index];
    if (option === undefined) return;
    onChange(option.value);
    buttons.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const target = tabTargetIndex(
      event.key,
      options.findIndex((option) => option.value === value),
      options.length,
    );
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  }

  return (
    <div
      className="ui-tabs"
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            className="ui-tab"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(option.value);
            }}
          >
            {option.label}
            {option.count === undefined ? null : (
              <span className="ui-tab-count">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
