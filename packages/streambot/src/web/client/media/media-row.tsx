import {
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Link, useNavigate } from "react-router";
import { Artwork } from "./artwork.tsx";
import { PlayActions } from "./play-actions.tsx";
import { enterIntent, itemDetail, type MediaItem } from "./row-model.ts";
import "@shepherdjerred/streambot/web/client/styles/row.css";

/** Moves focus between rows of the same list scope with the arrow keys. */
function moveRowFocus(row: HTMLElement, step: 1 | -1): boolean {
  const scope = row.closest("[data-row-scope]") ?? document;
  const rows = [...scope.querySelectorAll<HTMLElement>("[data-row]")];
  const next = rows[rows.indexOf(row) + step];
  next?.focus();
  return next !== undefined;
}

/** A live game's status, said in words beside its title. */
function LiveBadge(props: { item: MediaItem }) {
  if (props.item.status === undefined) return null;
  const startsAt =
    props.item.startsAt === undefined
      ? null
      : new Date(props.item.startsAt).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        });
  if (props.item.status === "live")
    return <span className="badge badge-live">Live</span>;
  if (props.item.status === "scheduled")
    return (
      <span className="badge">
        {startsAt === null ? "Upcoming" : "Starts " + startsAt}
      </span>
    );
  return <span className="badge">Time unconfirmed</span>;
}

/** What sits at the end of a row: its own action, an Open link, or the play buttons. */
function RowTrailing(props: {
  item: MediaItem;
  actions: ReactNode;
  actionsRef: RefObject<HTMLDivElement | null>;
}) {
  const { item } = props;
  // A custom action renders its own `.row-actions` and `.row-status` children.
  if (props.actions !== undefined) return props.actions;
  if (item.actions.length === 0 && item.href !== undefined)
    return (
      <Link className="btn btn-ghost row-open" to={item.href}>
        Open <span className="visually-hidden">{item.title}</span>
      </Link>
    );
  return <PlayActions item={item} actionsRef={props.actionsRef} />;
}

/**
 * The one row used by every list: search results, Home, and the browse pages. Its buttons are its
 * destinations; Enter presses the only button, or moves to the pair when there are two.
 */
export function MediaRow(props: {
  item: MediaItem;
  /**
   * Replaces the play buttons for rows whose action is not playing (for example Schedule): a
   * `.row-actions` element and, for its feedback, a `.row-status` element.
   */
  actions?: ReactNode;
}) {
  const { item } = props;
  const actions = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const detail = itemDetail(item);

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (moveRowFocus(event.currentTarget, event.key === "ArrowDown" ? 1 : -1))
        event.preventDefault();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const intent = enterIntent(item);
    // The row itself holds its buttons, whether they came from PlayActions or a custom slot.
    const row = event.currentTarget;
    switch (intent.kind) {
      case "play":
        row
          .querySelector<HTMLButtonElement>(`[data-action="${intent.action}"]`)
          ?.click();
        break;
      case "focus-actions":
        row.querySelector<HTMLButtonElement>("[data-action]")?.focus();
        break;
      case "open":
        void navigate(intent.href);
        break;
      case "none":
        break;
    }
  };

  return (
    <li className="row" data-row tabIndex={-1} onKeyDown={onKeyDown}>
      <Artwork item={item} shape="thumb" />
      <div className="row-text">
        {item.href === undefined ? (
          <span className="row-title">{item.title}</span>
        ) : (
          <Link className="row-title row-link" to={item.href} tabIndex={-1}>
            {item.title}
          </Link>
        )}
        <span className="row-detail">
          <LiveBadge item={item} />
          {detail}
        </span>
      </div>
      <RowTrailing item={item} actions={props.actions} actionsRef={actions} />
    </li>
  );
}

/** Placeholder rows while a group loads, so results do not jump when they arrive. */
export function SkeletonRows(props: { count: number }) {
  return Array.from({ length: props.count }, (_, index) => (
    <li key={index} className="row row-skeleton" aria-hidden="true">
      <span className="artwork artwork-thumb" />
      <span className="row-text">
        <span className="skeleton-line" />
        <span className="skeleton-line skeleton-short" />
      </span>
    </li>
  ));
}
