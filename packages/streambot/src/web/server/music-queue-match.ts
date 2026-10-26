import { z } from "zod";
import { CommandSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { musicSource } from "@shepherdjerred/streambot/music/service.ts";
import { canControlItem } from "@shepherdjerred/streambot/discord/permissions.ts";
import { withMode } from "@shepherdjerred/streambot/sources/source.ts";
import { assertNumberedPlayback } from "@shepherdjerred/streambot/commands/numbered-playback.ts";
import type { WebMusicOwner } from "./music-owner.ts";
import type { WebSession } from "./session-store.ts";
import { readRequestInput, WebError } from "./errors.ts";

const InputSchema = z.strictObject({
  playback: CommandSchema,
  position: z.number().int().positive(),
  selectionId: z.string().optional(),
});
export class MusicQueueMatch {
  constructor(private readonly music: WebMusicOwner) {}
  async handle(request: Request, session: WebSession, guildId: string) {
    if (request.method !== "POST")
      throw new WebError(405, "method", "This method is not supported.");
    const input = await readRequestInput(InputSchema, request);
    if (input.playback.guildId !== guildId)
      throw new WebError(400, "guild_changed", "Refresh playback.");
    const context = await this.music.playback.commandContext(session, {
      ...input.playback,
      action: "volume",
      percent: 100,
    });
    const item = context.handle.view().queue[input.position - 1];
    const track = item?.source?.music;
    if (item === undefined || track === undefined)
      throw new WebError(
        409,
        "track_changed",
        "This queued song is no longer available.",
      );
    if (
      !canControlItem(
        context.userId,
        item.requesterId,
        context.commandDeps.config.discord.adminIds,
      )
    )
      throw new WebError(
        403,
        "requester_required",
        "Only the requester or an admin can change this recording.",
      );
    const feature = track.provider === "spotify" ? "spotify" : "catalog";
    await this.music.require(session, guildId, feature);
    context.guard();
    if (input.selectionId === undefined) {
      const matches = await this.music
        .service()
        .matches(
          track,
          AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
        );
      context.guard();
      return Response.json(
        matches.map((match) => ({
          ...match,
          selectionId: this.music.add(
            session,
            guildId,
            [musicSource(track, match.url)],
            feature,
          ),
        })),
      );
    }
    const replacement = this.music.get(
      session,
      guildId,
      input.selectionId,
    ).sources;
    const source = replacement[0];
    if (
      replacement.length !== 1 ||
      source?.kind !== "url" ||
      source.music?.id !== track.id ||
      source.music.provider !== track.provider
    )
      throw new WebError(
        400,
        "track_changed",
        "Choose a video for the same song.",
      );
    context.guard();
    const corrected = withMode(source, item.source?.mode);
    assertNumberedPlayback(
      context.commandDeps.playbackChannel,
      corrected.mode,
      false,
    );
    context.commandDeps.dispatch({
      type: "REPLACE_QUEUED",
      index: input.position,
      source: corrected,
    });
    return Response.json({ message: "Updated the queued recording." });
  }
}
