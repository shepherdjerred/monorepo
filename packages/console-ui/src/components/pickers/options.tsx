import type { LucideIcon } from "lucide-react";

/** One choice in a `Select` or `Combobox`. */
export type PickerOption = {
  readonly value: string;
  /** Sentence case; also what typing matches. */
  readonly label: string;
  readonly icon?: LucideIcon;
  /** A muted second line; typing matches it too. Hidden on the closed control. */
  readonly description?: string;
  readonly disabled?: boolean;
};

/** Options listed together under a muted heading. */
export type PickerGroup = {
  readonly label: string;
  readonly options: readonly PickerOption[];
};

/** Options, groups of options, or a mix (ungrouped ones list first). */
export type PickerOptions = readonly (PickerOption | PickerGroup)[];

/** Every option in display order. */
export function flattenOptions(entries: PickerOptions): PickerOption[] {
  return entries.flatMap((entry) =>
    "options" in entry ? entry.options : [entry],
  );
}

/** Groups in display order; ungrouped options form a first, unnamed group. */
export function groupOptions(entries: PickerOptions): PickerGroup[] {
  const loose = entries.flatMap((entry) => ("options" in entry ? [] : [entry]));
  const groups = entries.flatMap((entry) =>
    "options" in entry ? [entry] : [],
  );
  return [
    ...(loose.length === 0 ? [] : [{ label: "", options: loose }]),
    ...groups,
  ];
}

/** Whether every word typed appears in the option's label or description. */
export function matchesOption(option: PickerOption, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${option.label} ${option.description ?? ""}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * An option's row content: icon, label and, unless `compact`, its
 * description. The description is preceded by a hidden full stop so the
 * option reads as two sentences wherever the layout is lost.
 */
export function OptionContent({
  option,
  compact = false,
}: {
  readonly option: PickerOption;
  readonly compact?: boolean;
}): React.JSX.Element {
  const Icon = option.icon;
  return (
    <>
      {Icon === undefined ? null : (
        <Icon className="ui-menu-icon" aria-hidden="true" />
      )}
      <span className="ui-menu-text">
        <span className="ui-menu-label-text">{option.label}</span>
        {compact || option.description === undefined ? null : (
          <span className="ui-menu-description">
            <span className="ui-sr-only">. </span>
            {option.description}
          </span>
        )}
      </span>
    </>
  );
}
