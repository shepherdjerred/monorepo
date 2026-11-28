import { useState, type ReactElement } from "react";
import type { RenderLinkProps } from "@shepherdjerred/console-ui/components/link.tsx";
import { plainLink } from "@shepherdjerred/console-ui/components/link.tsx";
import { ICONS } from "@shepherdjerred/console-ui/icons.ts";

/** An overflow this small is shown outright; a toggle would hide less than it costs. */
const CAP_SLACK = 2;

/** How many of `length` items a list capped at `cap` shows while collapsed. */
export function cappedCount(length: number, cap: number): number {
  return length > cap + CAP_SLACK ? cap : length;
}

export type Capped<T> = {
  readonly shown: readonly T[];
  /** Items the cap is holding back while collapsed. */
  readonly hidden: number;
  /** Whether the list is long enough to need the toggle at all. */
  readonly capped: boolean;
  readonly expanded: boolean;
  readonly toggle: () => void;
};

/**
 * The first `cap` items of a list until it is expanded. Every long list in
 * the consoles goes through this, so they cap and expand the same way.
 */
export function useCapped<T>(items: readonly T[], cap: number): Capped<T> {
  const [expanded, setExpanded] = useState(false);
  const visible = cappedCount(items.length, cap);
  const capped = visible < items.length;
  return {
    shown: capped && !expanded ? items.slice(0, visible) : items,
    hidden: items.length - visible,
    capped,
    expanded,
    toggle: () => {
      setExpanded((value) => !value);
    },
  };
}

export type ListToggleProps = {
  readonly list: Capped<unknown>;
  /** The id of the list element the button expands. */
  readonly controls: string;
  /** Names the items for the total: `alerts` gives "Show all 40 alerts". */
  readonly noun?: string;
};

/** "Show all N" / "Show fewer" under a capped list; nothing when it fits. */
export function ListToggle({
  list,
  controls,
  noun,
}: ListToggleProps): React.JSX.Element | null {
  if (!list.capped) return null;
  const total = list.shown.length + (list.expanded ? 0 : list.hidden);
  const Icon = list.expanded ? ICONS.collapse : ICONS.expand;
  return (
    <button
      type="button"
      className="ui-btn ui-list-toggle"
      aria-expanded={list.expanded}
      aria-controls={controls}
      onClick={list.toggle}
    >
      {list.expanded
        ? "Show fewer"
        : `Show all ${String(total)}${noun === undefined ? "" : ` ${noun}`}`}
      <Icon aria-hidden="true" />
    </button>
  );
}

export type PagerProps = {
  readonly label: string;
  /** Href of the newer page; omit on the first page. */
  readonly newerHref?: string;
  /** Href of the older page; omit on the last page. */
  readonly olderHref?: string;
  readonly renderLink?: (props: RenderLinkProps) => ReactElement;
};

/**
 * Keyset paging: "Newest" and "Older" links. A direction with no href
 * renders as disabled text, not a dead link.
 */
export function Pager({
  label,
  newerHref,
  olderHref,
  renderLink = plainLink,
}: PagerProps): React.JSX.Element {
  const item = (href: string | undefined, text: string): React.JSX.Element =>
    href === undefined ? (
      <span className="ui-btn" aria-disabled="true" data-disabled="">
        {text}
      </span>
    ) : (
      renderLink({
        href,
        className: "ui-btn",
        "aria-current": undefined,
        children: text,
      })
    );
  return (
    <nav className="ui-pager" aria-label={label}>
      {item(newerHref, "Newest")}
      {item(olderHref, "Older")}
    </nav>
  );
}
