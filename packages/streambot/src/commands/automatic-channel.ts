import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { PlaybackChannelNumberSchema } from "@shepherdjerred/streambot/types/playback-channel.ts";

export function automaticPlaybackChannel(
  source: Source,
  resolved: ResolvedSource | undefined,
) {
  if (source.kind === "url" && source.sportsEvent !== undefined)
    return PlaybackChannelNumberSchema.parse(2);
  if (source.mode === "music") return PlaybackChannelNumberSchema.parse(1);
  if (source.mode === "video" || source.kind === "file")
    return PlaybackChannelNumberSchema.parse(2);
  if (resolved === undefined)
    throw new Error("Automatic URL routing requires resolved media metadata");
  return PlaybackChannelNumberSchema.parse(
    resolved.mediaKind === "music" ? 1 : 2,
  );
}
