import type { z } from "zod";
import {
  apiRequest,
  postJson,
  type ApiFailure,
} from "@shepherdjerred/streambot/web/client/api.ts";
import { playerCommand } from "@shepherdjerred/streambot/web/client/commands.ts";
import type { Remote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import type { Outcome } from "@shepherdjerred/streambot/web/client/use-control.ts";
import type { WebCommand } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { PlaylistRequest } from "./playlist-model.ts";

export const PLAYLISTS_URL = "/api/playlists";

/** A request built when it runs, or the reason there is nothing to send. */
export type Built =
  | { readonly ok: true; readonly body: PlaylistRequest }
  | { readonly ok: false; readonly failure: ApiFailure };

/**
 * One playlist mutation as a control task. `build` runs when the task runs, so Retry sends the
 * latest revision; `finish` turns the server's answer into the confirmation words.
 */
export function mutationTask<T>(
  remote: Remote,
  schema: z.ZodType<T>,
  build: () => Built,
  finish: (data: T) => string,
): (signal: AbortSignal) => Promise<Outcome> {
  return async (signal) => {
    const built = build();
    if (!built.ok) return { ok: false, failure: built.failure };
    const result = await apiRequest(
      PLAYLISTS_URL,
      schema,
      postJson(built.body, remote.me.csrfToken, signal),
    );
    return result.ok
      ? { ok: true, message: finish(result.data) }
      : { ok: false, failure: result.failure };
  };
}

/**
 * The command that names a room player's queue (the server reads the queue from it). It must be
 * for the server the viewer is in, or the server refuses it.
 */
export function playbackFor(
  remote: Remote,
  slot: number,
): { guildId: string; playback: WebCommand } | null {
  const target = remote.latestTarget();
  const player = remote
    .latestRoom()
    ?.players.find((candidate) => candidate.slot === slot);
  if (target === null || player === undefined) return null;
  return {
    guildId: target.guildId,
    playback: playerCommand(target, player, { action: "volume", percent: 100 }),
  };
}
