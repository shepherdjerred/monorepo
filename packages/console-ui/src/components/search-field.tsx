import { ICONS } from "@shepherdjerred/console-ui/icons.ts";

export type SearchFieldProps = Omit<
  React.ComponentProps<"input">,
  "className" | "type"
> & {
  /** Accessible name; visually hidden, the icon and placeholder stand in. */
  readonly label: string;
};

const SearchIcon = ICONS.search;

/**
 * A 28px search input on the field look, with a leading icon. `ref`
 * reaches the `<input>`, e.g. to focus it from a `/` shortcut.
 */
export function SearchField({
  label,
  ...props
}: SearchFieldProps): React.JSX.Element {
  return (
    <label className="ui-search">
      <span className="ui-sr-only">{label}</span>
      <SearchIcon aria-hidden="true" />
      <input {...props} type="search" className="ui-search-input" />
    </label>
  );
}
