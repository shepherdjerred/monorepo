import type { ReactNode } from "react";
import { cx } from "./cx.ts";

export type TabItem<T extends string> = {
  readonly id: T;
  readonly label: string;
  readonly icon?: ReactNode;
};

/** A segmented tab bar; the caller renders the selected panel. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-border-subtle bg-surface-sunken p-1 shadow-[inset_0_2px_6px_rgb(0_0_0/0.4)]"
    >
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              onChange(item.id);
            }}
            className={cx(
              "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 font-display text-[15px] tracking-wide italic transition-colors",
              // The selected tab is a menu button from the game: red, with
              // yellow lettering.
              selected
                ? "bg-[linear-gradient(180deg,#ff3448,#c40f24)] text-mk-yellow shadow-[0_2px_0_#7a0915,inset_0_1px_0_rgb(255_255_255/0.3)] [text-shadow:0_1px_0_rgb(80_0_10/0.8)]"
                : "text-ink-muted hover:bg-white/5 hover:text-ink",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
