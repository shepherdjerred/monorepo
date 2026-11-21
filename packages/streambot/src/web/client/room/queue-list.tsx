import type { WebRoomPlayer } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { useState } from "react";
import { SaveQueueDialog } from "@shepherdjerred/streambot/web/client/playlists/save-queue-dialog.tsx";
import { ConfirmButton } from "./confirm-button.tsx";
import { ControlStatus } from "@shepherdjerred/streambot/web/client/control-status.tsx";
import { playerTask } from "./player-task.ts";
import { formatTime } from "./position.ts";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import {
  useControl,
  useControlGroup,
} from "@shepherdjerred/streambot/web/client/use-control.ts";

type QueueItem = WebRoomPlayer["queue"][number];

/** One queued item with its own move and remove controls and its own feedback line. */
function QueueEntry(props: {
  slot: number;
  item: QueueItem;
  position: number;
  count: number;
}) {
  const remote = useRemote();
  const control = useControl();
  const { position, item } = props;
  const move = (to: number) => {
    control.run(
      playerTask(remote, props.slot, { action: "move", from: position, to }),
    );
  };
  const detail = [
    item.requester?.name,
    item.durationSeconds === null
      ? undefined
      : formatTime(item.durationSeconds),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
  return (
    <li className="queue-item" aria-busy={control.pending}>
      <span className="queue-number numeric" aria-hidden="true">
        {position}
      </span>
      <span className="queue-text">
        <span className="queue-title">{item.title}</span>
        <span className="queue-detail">{detail}</span>
      </span>
      <span className="queue-actions">
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-small"
          aria-label={`Move ${item.title} up`}
          disabled={position === 1 || control.pending}
          onClick={() => {
            move(position - 1);
          }}
        >
          <span aria-hidden="true">↑</span>
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-small"
          aria-label={`Move ${item.title} down`}
          disabled={position === props.count || control.pending}
          onClick={() => {
            move(position + 1);
          }}
        >
          <span aria-hidden="true">↓</span>
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-small"
          aria-label={`Remove ${item.title} from the queue`}
          disabled={control.pending}
          onClick={() => {
            control.run(
              playerTask(remote, props.slot, { action: "remove", position }),
            );
          }}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </span>
      <ControlStatus className="queue-status" control={control} />
    </li>
  );
}

/** A player's "Up next" list, with Shuffle and Clear for the whole queue. */
export function QueueList(props: { player: WebRoomPlayer }) {
  const remote = useRemote();
  const { player } = props;
  const group = useControlGroup({ shuffle: useControl(), clear: useControl() });
  const [saving, setSaving] = useState(false);
  const count = player.queue.length;
  return (
    <section className="queue" aria-label="Up next">
      <div className="queue-head">
        <h3 className="queue-heading">
          Up next <span className="muted numeric">({count})</span>
        </h3>
        {remote.room?.capabilities.playlists === true &&
          (count > 0 || player.current !== null) && (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => {
                setSaving(true);
              }}
            >
              Save as playlist
            </button>
          )}
        {count > 1 && (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            aria-busy={group.controls.shuffle.pending}
            disabled={group.controls.shuffle.pending}
            onClick={() => {
              group.start(
                "shuffle",
                playerTask(remote, player.slot, { action: "shuffle" }),
              );
            }}
          >
            Shuffle
          </button>
        )}
        {count > 0 && (
          <ConfirmButton
            label="Clear the queue"
            confirm="Clear"
            className="btn btn-ghost btn-small"
            pending={group.controls.clear.pending}
            onConfirm={() => {
              group.start(
                "clear",
                playerTask(remote, player.slot, { action: "clear" }),
              );
            }}
          >
            Clear
          </ConfirmButton>
        )}
      </div>
      <ControlStatus control={group.status} />
      {saving && (
        <SaveQueueDialog
          slot={player.slot}
          onClose={() => {
            setSaving(false);
          }}
        />
      )}
      {count === 0 ? (
        <p className="queue-empty">Nothing queued.</p>
      ) : (
        <ol className="queue-items">
          {player.queue.map((item, index) => (
            <QueueEntry
              key={item.token ?? String(index) + item.title}
              slot={player.slot}
              item={item}
              position={index + 1}
              count={count}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
