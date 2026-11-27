import { Input } from "@scout-for-lol/design-system/components/input";
import { Search } from "lucide-react";

/** The search field in a hero: a pill with a lens, labelled for assistive technology. */
export function HeroSearch(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <form
      role="search"
      className="relative mt-6 block w-full max-w-[380px] text-scout-subtle"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <label className="scout-sr-only" htmlFor={props.id}>
        {props.label}
      </label>
      <Search
        aria-hidden="true"
        size={18}
        className="pointer-events-none absolute top-1/2 left-5 -mt-[9px]"
      />
      <Input
        id={props.id}
        name="find"
        type="search"
        placeholder={props.label}
        autoComplete="off"
        value={props.value}
        onChange={(event) => {
          props.onChange(event.currentTarget.value);
        }}
        className="h-[52px] rounded-full border-0 bg-[var(--scout-surface-inset)] pr-5 pl-12 text-base font-semibold shadow-[var(--scout-ring)] hover:bg-[var(--scout-surface-inset-strong)]"
      />
    </form>
  );
}
