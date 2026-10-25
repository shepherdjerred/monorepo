import type { WebPlayback } from "./playback.ts";
import type { WebSession } from "./session-store.ts";
import { GuildIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { WebError } from "./errors.ts";

export async function browseSports(input: {
  request: Request;
  session: WebSession;
  playback: WebPlayback;
  guildId: string;
}) {
  const { request, session, playback, guildId } = input;
  const url = new URL(request.url);
  const channel = playback.deps.bot.webVoiceChannel(
    GuildIdSchema.parse(guildId),
    session.identity.userId,
  );
  const scope = {
    guildId,
    userId: session.identity.userId,
    channelId: channel?.id ?? "web",
  };
  const lol = (await playback.deps.featureGate.lolEsports?.(scope)) === true;
  if (!lol && url.searchParams.get("provider") === "lolesports")
    throw new WebError(403, "lol_disabled", "LoL Esports is not enabled here.");
  if (!(await playback.sportsEnabled(session, guildId)))
    throw new WebError(
      403,
      "sports_disabled",
      "Live sports are not enabled in this server.",
    );
  const scheduling =
    playback.deps.schedules !== undefined &&
    (await playback.deps.featureGate.lolAutoplay?.(scope)) === true;
  const events = await playback.deps.catalog.sports.browse(
    url.searchParams,
    session.key + ":" + guildId,
    AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    { lol, scheduling },
  );
  return Response.json(events);
}
