import { SearchIcon } from "lucide-react";

export type SearchFieldProps = Omit<
  React.ComponentProps<"input">,
  "className" | "type"
> & {
  /** Accessible name; visually hidden, the icon and placeholder stand in. */
  readonly label: string;
};

/** A search input with a leading icon, sized like the page controls. */
export function SearchField({
  label,
  ...props
}: SearchFieldProps): React.JSX.Element {
  return (
    <label className="ui-search">
      <span className="ui-sr-only">{label}</span>
      <SearchIcon aria-hidden="true" />
      <input {...props} type="search" className="ui-input" />
    </label>
  );
}
