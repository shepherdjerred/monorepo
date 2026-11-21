import type { ApiFailure } from "@shepherdjerred/streambot/web/client/api.ts";
import {
  playerCommand,
  stationCommand,
  type PlayerAction,
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

/**
 * A control on one player card, built when it runs (not when it was clicked) so a Retry uses the
 * latest revision and current item. The rail redraws from the room stream, so success needs no
 * words unless `confirm` asks for the server's.
 */
export function playerTask(
  remote: Remote,
  slot: number,
  action: PlayerAction,
  confirm = false,
): (signal: AbortSignal) => Promise<Outcome> {
  return async (signal) => {
    const target = remote.latestTarget();
    if (target === null) return { ok: false, failure: NO_VOICE };
    const player = remote
      .latestRoom()
      ?.players.find((candidate) => candidate.slot === slot);
    if (player === undefined) return { ok: false, failure: GONE };
    const result = await remote.send(
      playerCommand(target, player, action),
      signal,
    );
    if (!result.ok) return { ok: false, failure: result.failure };
    return { ok: true, message: confirm ? result.data.message : "" };
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
