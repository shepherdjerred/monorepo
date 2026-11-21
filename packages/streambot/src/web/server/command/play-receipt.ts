import type { PlaybackEvent } from "@shepherdjerred/streambot/machine/types.ts";
import { sportsEventForSource } from "@shepherdjerred/streambot/sports/sports-resolver.ts";
import {
  withMode,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import {
  awaitPlaybackStart,
  type DispatchedItem,
} from "@shepherdjerred/streambot/session/item-tokens.ts";
import {
  playbackTransport,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import {
  webTimeToPlaybackSeconds,
  type WebTransportLabel,
} from "@shepherdjerred/streambot/observability/web-metrics.ts";
import type {
  WebCommandResult,
  WebTransport,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";

type PlayEvent = Extract<
  PlaybackEvent,
  { type: "ADD" | "ADD_NEXT" | "PLAY_NOW" | "ADD_BATCH" }
>;

/** The event when it adds media to a queue, otherwise `null`. */
export function playEvent(event: PlaybackEvent): PlayEvent | null {
  return event.type === "ADD" ||
    event.type === "ADD_NEXT" ||
    event.type === "PLAY_NOW" ||
    event.type === "ADD_BATCH"
    ? event
    : null;
}

export function transportMode(transport: WebTransport): "music" | "video" {
  return transport === "listen" ? "music" : "video";
}

function transportOf(mode: string | undefined): WebTransport | undefined {
  if (mode === "music") return "listen";
  return mode === "video" ? "watch" : undefined;
}

/** Listen and Watch fix every item's mode, including on a legacy room's single queue. */
export function withTransport(
  sources: readonly Source[],
  transport: WebTransport,
): readonly Source[] {
  const mode = transportMode(transport);
  return sources.map((source) => withMode(source, mode));
}

export function isSportsSource(source: Source): boolean {
  return (
    source.kind === "url" &&
    (source.sportsEvent !== undefined ||
      sportsEventForSource(source.url) !== null)
  );
}

/** What one web play command did: where its first item went and when it started. */
export class PlayReceipt {
  readonly acceptedAt = performance.now();
  /** Set when ffprobe refused an explicit video request during resolution. */
  noVideo = false;
  private transport: WebTransport | undefined;
  private position: number | undefined;
  private recorded = false;

  constructor(readonly requested: WebTransport | undefined) {}

  get label(): WebTransportLabel {
    return this.requested ?? "unspecified";
  }

  /** Called for every play event a command dispatches; the first one describes the request. */
  record(
    event: PlayEvent,
    slot: PlaybackChannelNumber | undefined,
    placed: DispatchedItem | null,
  ): void {
    if (this.recorded) return;
    this.recorded = true;
    const first = event.type === "ADD_BATCH" ? event.items[0] : event;
    this.transport =
      slot === undefined
        ? (transportOf(first?.source.mode) ??
          transportOf(first?.preResolved?.mediaKind))
        : transportOf(playbackTransport(slot));
    if (placed === null) return;
    this.position = placed.position;
    if (placed.position !== 0) return;
    const label = this.label;
    awaitPlaybackStart(placed.token, () => {
      webTimeToPlaybackSeconds.observe(
        { transport: label },
        (performance.now() - this.acceptedAt) / 1000,
      );
    });
  }

  /** Result fields for the requesting viewer; the channel name never reaches logs or metrics. */
  result(
    voiceChannelName: string | undefined,
  ): Pick<WebCommandResult, "destination" | "position"> {
    const transport = this.transport ?? this.requested;
    return {
      ...(transport === undefined || voiceChannelName === undefined
        ? {}
        : { destination: { transport, voiceChannelName } }),
      ...(this.position === undefined ? {} : { position: this.position }),
    };
  }
}
