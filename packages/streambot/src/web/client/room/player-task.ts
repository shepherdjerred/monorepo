import type { WebRoomPlayer } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { ApiFailure } from "@shepherdjerred/streambot/web/client/api.ts";
import {
  playerCommand,
  stationCommand,
  type PlayerAction,
  type RoomTarget,
  type StationRequest,
} from "@shepherdjerred/streambot/web/client/commands.ts";
import {
  NO_VOICE,
  type Remote,
} from "@shepherdjerred/streambot/web/client/remote.tsx";
import type { Outcome } from "@shepherdjerred/streambot/web/client/use-control.ts";

const GONE: ApiFailure = {
  status: 0,
  code: "no_session",
  message: "",
  reference: null,
};

/** The viewer's voice channel and this card's player as they are now, or why there is none. */
function latestPlayer(
  remote: Remote,
  slot: number,
):
  | { ok: true; target: RoomTarget; player: WebRoomPlayer }
  | { ok: false; failure: ApiFailure } {
  const target = remote.latestTarget();
  if (target === null) return { ok: false, failure: NO_VOICE };
  const player = remote
    .latestRoom()
    ?.players.find((candidate) => candidate.slot === slot);
  return player === undefined
    ? { ok: false, failure: GONE }
    : { ok: true, target, player };
}

/**
 * A control on one player card, built when it runs (not when it was clicked) so a Retry uses the
 * latest revision and current item. The rail redraws from the room stream, so success needs no
 * words unless `confirm` asks for the server's. Queue edits name positions and use `queueTask`.
 */
export function playerTask(
  remote: Remote,
  slot: number,
  action: Exclude<PlayerAction, QueueEdit>,
  confirm = false,
): (signal: AbortSignal) => Promise<Outcome> {
  return async (signal) => {
    const latest = latestPlayer(remote, slot);
    if (!latest.ok) return latest;
    const result = await remote.send(
      playerCommand(latest.target, latest.player, action),
      signal,
    );
    if (!result.ok) return { ok: false, failure: result.failure };
    return { ok: true, message: confirm ? result.data.message : "" };
  };
}

/** A queue edit, which names positions in the list the viewer was looking at. */
export type QueueEdit =
  | { action: "remove"; position: number }
  | { action: "move"; from: number; to: number };

/** What the viewer clicked: the list's revision and the item at the edit's position then. */
export type QueueClick = {
  readonly revision: string | null;
  readonly token: string | undefined;
};

const QUEUE_CHANGED: ApiFailure = {
  status: 0,
  code: "queue_changed",
  message: "",
  reference: null,
};

/**
 * A queue edit pinned to the list as it was clicked. Positions only mean something in that list,
 * so the task keeps the click's revision on every run (a Retry included) and refuses locally when
 * the item at that position is no longer the one clicked. The server's `playback_changed` means
 * the same thing and is not retryable here: the viewer acts again on the fresh list.
 */
export function queueTask(
  remote: Remote,
  slot: number,
  edit: QueueEdit,
  click: QueueClick,
): (signal: AbortSignal) => Promise<Outcome> {
  const position = edit.action === "remove" ? edit.position : edit.from;
  return async (signal) => {
    const latest = latestPlayer(remote, slot);
    if (!latest.ok) return latest;
    const item = latest.player.queue[position - 1];
    if (item === undefined || item.token !== click.token)
      return { ok: false, failure: QUEUE_CHANGED };
    const result = await remote.send(
      playerCommand(
        latest.target,
        { slot, revision: click.revision, current: latest.player.current },
        edit,
      ),
      signal,
    );
    if (result.ok) return { ok: true, message: "" };
    return result.failure.code === "playback_changed"
      ? {
          ok: false,
          failure: {
            ...QUEUE_CHANGED,
            status: result.failure.status,
            reference: result.failure.reference,
          },
        }
      : { ok: false, failure: result.failure };
  };
}

/** Starts or stops a Radio/TV station; its confirmation is the server's description. */
export function stationTask(
  remote: Remote,
  request: StationRequest,
): (signal: AbortSignal) => Promise<Outcome> {
  return async (signal) => {
    const target = remote.latestTarget();
    if (target === null) return { ok: false, failure: NO_VOICE };
    const result = await remote.send(stationCommand(target, request), signal);
    return result.ok
      ? { ok: true, message: result.data.message }
      : { ok: false, failure: result.failure };
  };
}
