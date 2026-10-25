import type { PlaybackCommandServiceDeps } from "./playback-command-types.ts";
import { PlaybackCommandService } from "./playback-command-service.ts";
import {
  sourceLabel,
  withMode,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import { isBlockedSource } from "@shepherdjerred/streambot/moderation/adult-block.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";
import type { QueuedSource } from "@shepherdjerred/streambot/machine/types.ts";
import { toRecordMedia, markReplacedRequest } from "./playback-recording.ts";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import { PlaybackCommandBoundaryError } from "./playback-command-errors.ts";
import { assertNumberedPlayback } from "./numbered-playback.ts";
import { automaticPlaybackChannel } from "./automatic-channel.ts";

type BatchInput = {
  deps: PlaybackCommandServiceDeps;
  sources: readonly Source[];
  userId: UserId;
  placement: "queue" | "next" | "now";
  signal: AbortSignal;
};
type Group = { target: PlaybackCommandServiceDeps; items: QueuedSource[] };

/** Stages metadata and checks authority before committing an ordered batch. */
class QueueBatch {
  private readonly groups = new Map<string, Group>();
  private readonly routes = new Map<number, PlaybackCommandServiceDeps>();
  private readonly modes = new Map<string, Source["mode"]>();
  private skipped = 0;
  constructor(private readonly input: BatchInput) {}
  private guard() {
    this.input.signal.throwIfAborted();
    this.input.deps.assertCurrent?.();
    for (const { target } of this.groups.values()) target.assertCurrent?.();
  }
  private async targetFor(source: Source) {
    const { deps, userId } = this.input;
    // Generic video playlists retain video intent; catalog and Spotify sources carry music intent.
    const routing =
      source.mode === undefined || source.mode === "auto"
        ? withMode(source, "video")
        : source;
    const number =
      deps.routePlayback === undefined
        ? 0
        : automaticPlaybackChannel(routing, undefined);
    let target = this.routes.get(number);
    if (target === undefined) {
      target = (await deps.routePlayback?.(routing, undefined, userId)) ?? deps;
      this.routes.set(number, target);
    }
    return target;
  }
  private async prepare(original: Source) {
    this.guard();
    if (isBlockedSource(original)) {
      this.skipped += 1;
      return;
    }
    const { userId, placement } = this.input;
    const target = await this.targetFor(original);
    const key =
      (target.guildId ?? "") +
      ":" +
      (target.channelId ?? "") +
      ":" +
      String(target.playbackChannel ?? "legacy");
    const group = this.groups.get(key) ?? { target, items: [] };
    const service = new PlaybackCommandService(target);
    if (placement === "now") service.assertCanPlayNow(userId);
    const modeKey = key + ":" + (original.mode ?? "auto");
    if (!this.modes.has(modeKey))
      this.modes.set(
        modeKey,
        await service.resolveMediaMode(userId, original.mode),
      );
    const source = withMode(original, this.modes.get(modeKey));
    assertNumberedPlayback(target.playbackChannel, source.mode, false);
    group.items.push({
      source,
      requesterId: userId,
      queuedAt: Date.now(),
      display: {
        title: sourceLabel(source),
        ...(source.music?.durationSeconds === undefined
          ? {}
          : { durationSeconds: source.music.durationSeconds }),
      },
    });
    this.groups.set(key, group);
  }
  private commit(group: Group, record: boolean) {
    const { deps, userId, placement } = this.input;
    const scope =
      deps.guildId === undefined || deps.channelId === undefined
        ? null
        : { guildId: deps.guildId, channelId: deps.channelId, userId };
    const history = deps.history;
    const items = group.items.map((item) => {
      if (!record || scope === null || history === undefined) return item;
      const title = sourceLabel(item.source);
      return {
        ...item,
        requestId: history.recordQueueRequest({
          scope,
          rawQuery: title,
          intent: inferMediaIntent({ query: title, placement, source: "auto" }),
          media: toRecordMedia(item.source, undefined, undefined),
        }),
      };
    });
    if (placement === "now") {
      const first = items[0];
      if (first === undefined) return 0;
      markReplacedRequest(group.target);
      group.target.dispatch({ type: "PLAY_NOW", ...first });
      group.target.dispatch({
        type: "ADD_BATCH",
        items: items.slice(1),
        placement:
          group.target.view().current === null ? "after-first" : "next",
      });
    } else group.target.dispatch({ type: "ADD_BATCH", items, placement });
    return items.length;
  }
  async run() {
    const { deps, sources, userId, placement } = this.input;
    if (sources.length === 0)
      throw new PlaybackCommandBoundaryError(
        "This playlist has no playable tracks.",
      );
    if (
      placement === "now" &&
      !(await new PlaybackCommandService(deps).isAssistantV2Enabled(userId))
    )
      throw new PlaybackCommandBoundaryError(
        "Playing now is not enabled here yet.",
      );
    for (const source of sources) await this.prepare(source);
    const scope =
      deps.guildId === undefined || deps.channelId === undefined
        ? null
        : { guildId: deps.guildId, channelId: deps.channelId, userId };
    const record =
      scope !== null &&
      deps.history !== undefined &&
      (deps.featureGate === undefined ||
        (await deps.featureGate.history(scope)));
    this.guard();
    let count = 0;
    for (const group of this.groups.values())
      count += this.commit(group, record);
    return {
      message:
        "Queued " +
        String(count) +
        " track(s)." +
        (this.skipped === 0
          ? ""
          : " " + String(this.skipped) + " unavailable item(s) omitted."),
    };
  }
}
export function queueBatch(input: BatchInput): Promise<{ message: string }> {
  return new QueueBatch(input).run();
}
