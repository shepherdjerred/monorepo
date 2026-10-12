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
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-border-subtle bg-surface-sunken p-1"
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
              "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors",
              selected
                ? "bg-surface-raised text-ink shadow-[0_1px_0_rgb(255_255_255/0.06)_inset]"
                : "text-ink-faint hover:text-ink-muted",
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
