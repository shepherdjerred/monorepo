import { useState, type ReactNode, type Ref } from "react";
import type { RowAction } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import type { WebRoom } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  playCommand,
  playConfirmation,
  TRANSPORT_NAME,
  type Placement,
} from "@shepherdjerred/streambot/web/client/commands.ts";
import { ControlStatus } from "@shepherdjerred/streambot/web/client/control-status.tsx";
import {
  NO_VOICE,
  useRemote,
  type Remote,
} from "@shepherdjerred/streambot/web/client/remote.tsx";
import { trackResultChosen } from "@shepherdjerred/streambot/web/client/telemetry/track.ts";
import { RowMenu, type MenuItem } from "./row-menu.tsx";
import type { MediaItem } from "./row-model.ts";
import {
  useControl,
  type Control,
  type Outcome,
} from "@shepherdjerred/streambot/web/client/use-control.ts";

const GLYPH: Readonly<Record<RowAction, string>> = { listen: "♪", watch: "▶" };

/** True when something already plays on that destination, so its button adds to the queue. */
export function destinationActive(
  room: WebRoom | null,
  transport: RowAction,
): boolean {
  return (
    room?.players.some(
      (player) =>
        player.transport === transport &&
        (player.current !== null || player.queue.length > 0),
    ) ?? false
  );
}

type ControlKey = RowAction | "menu";
type PlayRequest = {
  transport: RowAction;
  placement: Placement;
  anotherStream?: boolean;
};

function playTask(
  remote: Remote,
  item: MediaItem,
  request: PlayRequest,
): (signal: AbortSignal) => Promise<Outcome> {
  return async (signal) => {
    const target = remote.latestTarget();
    if (target === null) return { ok: false, failure: NO_VOICE };
    if (item.selection === null)
      throw new Error("A play action needs a selection");
    const result = await remote.send(
      playCommand(target, { selection: item.selection, ...request }),
      signal,
    );
    return result.ok
      ? { ok: true, message: playConfirmation(result.data, request.transport) }
      : { ok: false, failure: result.failure };
  };
}

/** A destination the server offers only from the menu, such as a song's music video. */
const MENU_LABEL: Readonly<Record<RowAction, string>> = {
  watch: "Watch the video",
  listen: "Listen only",
};

function menuItems(
  remote: Remote,
  item: MediaItem,
  play: (request: PlayRequest) => void,
): MenuItem[] {
  const items: MenuItem[] = [];
  const single = item.actions.length === 1;
  const verb = (transport: RowAction) =>
    single ? "Play" : TRANSPORT_NAME[transport];
  for (const transport of item.actions)
    items.push({
      key: "next-" + transport,
      label: verb(transport) + " next",
      onSelect: () => {
        play({ transport, placement: "next" });
      },
    });
  if (remote.room?.capabilities.playNow === true)
    for (const transport of item.actions)
      items.push({
        key: "now-" + transport,
        label: verb(transport) + " now",
        onSelect: () => {
          play({ transport, placement: "now" });
        },
      });
  const menuOnly = item.menuActions ?? [];
  for (const transport of menuOnly)
    items.push({
      key: "menu-" + transport,
      label: MENU_LABEL[transport],
      onSelect: () => {
        play({ transport, placement: "queue" });
      },
    });
  const extraSlot = remote.target?.extraSlot ?? null;
  const watchable =
    item.actions.includes("watch") || menuOnly.includes("watch");
  if (extraSlot !== null && watchable)
    items.push({
      key: "another",
      label: "Start another stream",
      onSelect: () => {
        play({ transport: "watch", placement: "queue", anotherStream: true });
      },
    });
  return items;
}

/**
 * The play buttons of one row or card, its `⋯` menu, and the line that reports what happened.
 * Exactly `item.actions` become buttons, in order; each button keeps its own pending state.
 */
export function PlayActions(props: {
  item: MediaItem;
  actionsRef?: Ref<HTMLDivElement>;
  /** More `⋯` items, set apart from the play items by a separator (for example, management). */
  extraMenuItems?: readonly MenuItem[];
  /** Controls placed after the play buttons and before the `⋯` menu. */
  trailing?: ReactNode;
}) {
  const { item } = props;
  const remote = useRemote();
  const controls: Record<ControlKey, Control> = {
    listen: useControl(),
    watch: useControl(),
    menu: useControl(),
  };
  const [last, setLast] = useState<ControlKey | null>(null);
  const extras = props.extraMenuItems ?? [];
  const playable = item.selection !== null && item.actions.length > 0;
  if (!playable && extras.length === 0 && props.trailing === undefined)
    return null;
  const run = (key: ControlKey, request: PlayRequest) => {
    setLast(key);
    if (remote.target === null) {
      controls[key].explain(NO_VOICE);
      return;
    }
    trackResultChosen(item, key === "menu", request);
    controls[key].run(playTask(remote, item, request));
  };
  const played = playable
    ? menuItems(remote, item, (request) => {
        run("menu", request);
      })
    : [];
  const items = [
    ...played,
    ...extras.map((extra, index) =>
      index === 0 && played.length > 0
        ? { ...extra, separatorBefore: true }
        : extra,
    ),
  ];
  const noVoice = remote.target === null;
  return (
    <>
      <div className="row-actions btn-row" ref={props.actionsRef}>
        {item.actions.map((transport) => {
          const control = controls[transport];
          const queues = destinationActive(remote.room, transport);
          return (
            <button
              key={transport}
              type="button"
              data-action={transport}
              className={"btn btn-" + transport}
              aria-disabled={noVoice || control.pending}
              aria-busy={control.pending}
              aria-describedby={noVoice ? "voice-legend" : undefined}
              title={
                noVoice
                  ? "Join a voice channel in Discord to play"
                  : queues
                    ? `Adds to the ${TRANSPORT_NAME[transport]} queue`
                    : undefined
              }
              onClick={() => {
                if (!control.pending)
                  run(transport, { transport, placement: "queue" });
              }}
            >
              <span className="glyph" aria-hidden="true">
                {GLYPH[transport]}
              </span>
              {control.pending ? "Sending…" : TRANSPORT_NAME[transport]}
              <span className="visually-hidden">: {item.title}</span>
            </button>
          );
        })}
        {props.trailing}
        {items.length > 0 && (
          <RowMenu
            label={
              (extras.length > 0 ? "More actions for " : "More ways to play ") +
              item.title
            }
            items={items}
          />
        )}
      </div>
      <ControlStatus
        surface="row"
        className="row-status"
        control={last === null ? null : controls[last]}
      />
    </>
  );
}
