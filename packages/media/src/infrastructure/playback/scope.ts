import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import { MINIMUM_PLAY_MS } from "#domain/household/playback.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { PlaybackQuery } from "#shared/household/playback.ts";

export function playbackScope(
  actor: MediaActor,
  query: Omit<PlaybackQuery, "cursor">,
  completed = true,
): Prisma.PlaybackSessionWhereInput {
  if (
    actor.role !== "owner" &&
    query.userId !== undefined &&
    query.userId !== actor.id
  )
    throw new MediaError(
      "forbidden",
      "You can only view your own playback",
      403,
    );
  const from = query.from === undefined ? undefined : new Date(query.from);
  const to = query.to === undefined ? undefined : new Date(query.to);
  if (from !== undefined && to !== undefined && from >= to)
    throw new MediaError("invalid_range", "Start must be before end");
  return {
    ...(actor.role === "owner"
      ? query.userId === undefined
        ? {}
        : { userId: query.userId }
      : { userId: actor.id }),
    ...(completed
      ? { state: "stopped", watchedMs: { gte: MINIMUM_PLAY_MS } }
      : {}),
    ...dateScope(from, to),
    ...(query.source === undefined ? {} : { source: query.source }),
    ...(query.search === undefined || query.search === ""
      ? {}
      : {
          OR: [
            { title: { contains: query.search, mode: "insensitive" } },
            { seriesTitle: { contains: query.search, mode: "insensitive" } },
          ],
        }),
  };
}

function dateScope(
  from: Date | undefined,
  to: Date | undefined,
): Prisma.PlaybackSessionWhereInput {
  if (from === undefined && to === undefined) return {};
  return {
    startedAt: {
      ...(from === undefined ? {} : { gte: from }),
      ...(to === undefined ? {} : { lt: to }),
    },
  };
}
