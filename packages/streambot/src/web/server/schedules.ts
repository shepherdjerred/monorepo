import { z } from "zod";
import type { WebPlayback } from "./playback.ts";
import type { WebSession } from "./session-store.ts";
import { GuildIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { WebError, requestInput } from "./errors.ts";

export async function webSchedules(
  request: Request,
  session: WebSession,
  playback: WebPlayback,
): Promise<Response> {
  const url = new URL(request.url);
  const input =
    request.method === "GET"
      ? { guildId: url.searchParams.get("guildId") }
      : await request.json().catch((error: unknown) => {
          if (error instanceof SyntaxError)
            throw new WebError(
              400,
              "invalid_request",
              "Check your input and try again.",
            );
          throw error;
        });
  const guildId = requestInput(
    z.object({ guildId: GuildIdSchema }),
    input,
  ).guildId;
  await playback.authorize(session, guildId);
  const store = playback.deps.schedules;
  if (store === undefined)
    throw new WebError(
      503,
      "scheduling_unavailable",
      "Scheduled playback is unavailable.",
    );
  const userId = session.identity.userId;
  if (request.method === "GET")
    return Response.json(store.list(guildId, userId));
  if (url.pathname.endsWith("/cancel")) {
    const { id } = requestInput(z.object({ id: z.uuid() }), input);
    store.cancel(id, guildId, userId);
    return Response.json({ message: "Scheduled playback cancelled." });
  }
  const { selectionId } = requestInput(
    z.object({ selectionId: z.string().min(1) }),
    input,
  );
  const channel = playback.deps.bot.webVoiceChannel(guildId, userId);
  if (channel === null)
    throw new WebError(
      409,
      "join_voice",
      "Join the voice channel where you want the series to play.",
    );
  const scope = { guildId, channelId: channel.id, userId };
  const numbered = playback.deps.sessions.numbered;
  const slot = numbered.selection.isManual(scope)
    ? ((await numbered.selected(scope)) ?? 2)
    : 2;
  const event = playback.deps.catalog.sports.scheduledEvent(
    selectionId,
    session.key + ":" + guildId,
  );
  await store.create(
    event,
    { ...scope, channelName: channel.name, statusChannelId: channel.id, slot },
    AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
  );
  return Response.json({
    message: `Scheduled ${event.title} in video channel ${String(slot)}. It will start when live, with listeners present and the slot idle.`,
  });
}
