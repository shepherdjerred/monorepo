import { useRef, type KeyboardEvent } from "react";

export type TabOption<Value extends string> = {
  readonly value: Value;
  readonly label: string;
  readonly count?: number | string;
  /** Not selectable and skipped by the arrow keys, e.g. a plain-text tab when the message has no text part. */
  readonly disabled?: boolean;
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
 * The enabled option index a key moves to, stepping past disabled options;
 * undefined to ignore the key or when nothing else is enabled.
 */
export function enabledTargetIndex(
  key: string,
  current: number,
  disabled: readonly boolean[],
): number | undefined {
  const count = disabled.length;
  const step = STEP[key];
  if (step !== undefined) {
    for (let hop = 1; hop <= count; hop += 1) {
      const index = (((current + step * hop) % count) + count) % count;
      if (disabled[index] !== true) return index;
    }
    return undefined;
  }
  if (key === "Home") {
    const index = disabled.findIndex((off) => !off);
    return index === -1 ? undefined : index;
  }
  if (key === "End") {
    const index = disabled.findLastIndex((off) => !off);
    return index === -1 ? undefined : index;
  }
  return undefined;
}

/**
 * Underlined view tabs for filtering one list. They are a radio group, the
 * pattern the consoles already use for view toggles: one stop in the tab
 * order, arrow keys move the selection, Home and End jump to the ends.
 */
export function Tabs<Value extends string>(
  props: TabsProps<Value>,
): React.JSX.Element {
  return (
    <RadioOptions
      {...props}
      groupClass="ui-tabs"
      optionClass="ui-tab"
      countClass="ui-tab-count"
    />
  );
}

/**
 * The radio group behind `Tabs` and `Segmented`: they differ only in classes.
 */
export function RadioOptions<Value extends string>({
  label,
  options,
  value,
  onChange,
  groupClass,
  optionClass,
  countClass,
}: TabsProps<Value> & {
  readonly groupClass: string;
  readonly optionClass?: string;
  readonly countClass: string;
}): React.JSX.Element {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function select(index: number): void {
    const option = options[index];
    if (option === undefined) return;
    onChange(option.value);
    buttons.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const target = enabledTargetIndex(
      event.key,
      options.findIndex((option) => option.value === value),
      options.map((option) => option.disabled === true),
    );
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  }

  return (
    <div
      className={groupClass}
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
            className={optionClass}
            aria-checked={selected}
            disabled={option.disabled === true}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(option.value);
            }}
          >
            {option.label}
            {option.count === undefined ? null : (
              <span className={countClass}>{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
