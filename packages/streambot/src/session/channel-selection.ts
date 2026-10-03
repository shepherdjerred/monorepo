import {
  AUDIO_CHANNEL,
  PlaybackChannelNumberSchema,
  playbackChannelLabel,
  NUMBERED_CHANNEL_HINT,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";

export class ChannelSelection {
  private readonly selections = new Map<string, PlaybackChannelNumber>();
  private key(scope: DiscoveryScope): string {
    return `${scope.guildId}:${scope.channelId}:${scope.userId}`;
  }
  get(scope: DiscoveryScope): PlaybackChannelNumber {
    return this.selections.get(this.key(scope)) ?? AUDIO_CHANNEL;
  }
  select(scope: DiscoveryScope, value: number, maximum: number): string {
    const parsed = PlaybackChannelNumberSchema.safeParse(value);
    if (!parsed.success || value > maximum)
      return `Choose a Streambot channel from 1 to ${String(maximum)}. ${NUMBERED_CHANNEL_HINT}`;
    this.selections.set(this.key(scope), parsed.data);
    return `Selected ${playbackChannelLabel(parsed.data)}. ${NUMBERED_CHANNEL_HINT}`;
  }
  clear(scope: DiscoveryScope): void {
    this.selections.delete(this.key(scope));
  }
  list(
    scope: DiscoveryScope,
    maximum: number,
    get: (number: PlaybackChannelNumber) => SessionHandle | null,
    requestedPage?: number,
  ): string {
    const selected = this.get(scope);
    const pageSize = 10;
    const pages = Math.ceil(maximum / pageSize);
    const page = requestedPage ?? Math.floor((selected - 1) / pageSize) + 1;
    if (!Number.isInteger(page) || page < 1 || page > pages)
      return `Choose a channels page from 1 to ${String(pages)}.`;
    const start = (page - 1) * pageSize;
    const lines = Array.from(
      { length: Math.min(pageSize, maximum - start) },
      (_, index) => {
        const number = PlaybackChannelNumberSchema.parse(start + index + 1);
        const view = get(number)?.view();
        const current = view?.current;
        return `${number === selected ? "→ " : ""}${playbackChannelLabel(number)}: ${view?.state ?? "idle"}${current == null ? "" : ` · ${current.title.slice(0, 64)}`} · ${String(view?.queue.length ?? 0)} queued`;
      },
    );
    return `Streambot channels · page ${String(page)}/${String(pages)} · selected ${String(selected)}\n${lines.join("\n")}\n\n${NUMBERED_CHANNEL_HINT} Availability is shared across voice channels and servers.${pages > 1 ? " Use /stream channels page:<number> to see more." : ""}`;
  }
}
