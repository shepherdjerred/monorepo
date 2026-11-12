import { isArenaQueueOrMode } from "@scout-for-lol/data";
import { z } from "zod";

/**
 * Why a client capture is not converted: the mode's results come from Riot,
 * not from the desktop client. Arena (queues 1700/1740/1750, game mode
 * CHERRY) has no teams in its end-of-game block, drops subteam placement and
 * augments in the LCU participant, and Riot publishes the full result.
 */
export type UnsupportedClientMode = {
  kind: "unsupported_mode";
  mode: "arena";
};

export const ARENA_UNSUPPORTED: UnsupportedClientMode = {
  kind: "unsupported_mode",
  mode: "arena",
};

const ModeFieldsSchema = z.looseObject({
  queueId: z.number().optional(),
  gameMode: z.string().optional(),
});
const QueueFieldsSchema = z.looseObject({
  id: z.number().optional(),
  gameMode: z.string().optional(),
});
const HolderSchema = z.looseObject({
  matchHistory: z.unknown().optional(),
  endOfGame: z.unknown().optional(),
  gameData: z.looseObject({ queue: z.unknown().optional() }).optional(),
});

function isArenaFields(fields: {
  queueId?: number | undefined;
  gameMode?: string | undefined;
}) {
  if (fields.queueId === undefined && fields.gameMode === undefined)
    return false;
  // 0 is the custom queue: it never matches Arena and is not logged as unknown.
  return isArenaQueueOrMode(fields.queueId ?? 0, fields.gameMode ?? "");
}

/**
 * True when any queue or game mode stated by a client payload is Arena: the
 * match-history row (`queueId`/`gameMode`), the end-of-game block
 * (`gameMode`), a bundle holding either, or the gameflow context's
 * `gameData.queue`. Absence of a statement is not evidence of another mode.
 */
export function isArenaClientPayload(payload: unknown): boolean {
  const root = z.looseObject({ data: z.unknown() }).safeParse(payload);
  const data = root.success ? root.data.data : payload;
  const holder = HolderSchema.safeParse(data);
  const candidates = [
    data,
    ...(holder.success
      ? [holder.data.matchHistory, holder.data.endOfGame]
      : []),
  ];
  if (
    candidates.some((candidate) => {
      const parsed = ModeFieldsSchema.safeParse(candidate);
      return parsed.success && isArenaFields(parsed.data);
    })
  )
    return true;
  const queue = QueueFieldsSchema.safeParse(
    holder.success ? holder.data.gameData?.queue : undefined,
  );
  return (
    queue.success &&
    isArenaFields({ queueId: queue.data.id, gameMode: queue.data.gameMode })
  );
}
