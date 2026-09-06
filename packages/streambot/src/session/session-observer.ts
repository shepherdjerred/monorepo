import type { PlaybackContext } from "@shepherdjerred/streambot/machine/types.ts";
import {
  queueLength,
  setPlaybackState,
} from "@shepherdjerred/streambot/observability/metrics.ts";
import type { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { describeSnapshot } from "@shepherdjerred/streambot/session/status-snapshot.ts";
import type { Session } from "@shepherdjerred/streambot/session/session-types.ts";

type ObservedSnapshot = {
  readonly value: unknown;
  readonly context: PlaybackContext;
};

type SessionObserverOptions = {
  readonly session: Session;
  readonly history: MediaHistoryStore | undefined;
  readonly totalQueueLength: () => number;
};

const HISTORY_END_STATES = new Set([
  "advance",
  "skipped",
  "failed",
  "waiting",
  "idle",
]);

/** Projects actor snapshots into status, metrics, teardown, and durable playback history. */
export class SessionObserver {
  private activeRequestId: string | undefined;

  constructor(private readonly options: SessionObserverOptions) {}

  handle(snapshot: ObservedSnapshot): void {
    const { stateName, snap } = describeSnapshot(snapshot);
    this.finishInactiveRequest(stateName, snapshot.context);
    this.options.session.reporter.handle(snap);
    this.options.session.card.refresh();
    setPlaybackState(stateName);
    queueLength.set(this.options.totalQueueLength());
    this.updateLifecycle(stateName, snapshot.context.queue.length);
    this.updatePlaybackHistory(stateName, snapshot.context);
    this.trackResolvingRequest(stateName, snapshot.context);
  }

  private trackResolvingRequest(
    stateName: string,
    context: PlaybackContext,
  ): void {
    if (stateName === "resolving" && context.current?.requestId !== undefined) {
      this.activeRequestId = context.current.requestId;
    }
  }

  private finishInactiveRequest(
    stateName: string,
    context: PlaybackContext,
  ): void {
    if (this.activeRequestId === undefined) return;
    const activeState =
      stateName === "streaming" ||
      stateName === "paused" ||
      stateName === "resolving";
    if (activeState && context.current?.requestId === this.activeRequestId) {
      return;
    }
    this.options.history?.finishStartedRequest(
      this.activeRequestId,
      requestStatusForExit(stateName, context.lastError),
    );
    this.activeRequestId = undefined;
  }

  private updateLifecycle(stateName: string, queuedItems: number): void {
    const { session } = this.options;
    if (stateName !== "idle") {
      session.hasStarted = true;
    } else if (queuedItems === 0 && session.hasStarted) {
      session.teardownHold.request();
    }
  }

  private updatePlaybackHistory(
    stateName: string,
    context: PlaybackContext,
  ): void {
    if (
      stateName === "resolving" &&
      context.current?.requestId !== this.activeRequestId
    ) {
      this.options.session.historyRunRecorded = false;
    }
    if (stateName === "streaming" && !this.options.session.historyRunRecorded) {
      this.recordPlaybackStart(context);
    } else if (HISTORY_END_STATES.has(stateName)) {
      this.options.session.historyRunRecorded = false;
    }
  }

  private recordPlaybackStart(context: PlaybackContext): void {
    const current = context.current;
    const resolved = context.resolved;
    if (resolved === null || current?.requestId === undefined) return;

    const { session, history } = this.options;
    session.historyRunRecorded = true;
    this.activeRequestId = current.requestId;
    history?.recordPlaybackStart({
      requestId: current.requestId,
      scope: {
        guildId: session.guildId,
        channelId: session.voiceChannelId,
        userId: current.requesterId,
      },
      media: {
        title: resolved.title,
        provider: current.source.kind === "file" ? "local" : "youtube",
        source: current.source,
        ...(resolved.provenance?.canonicalUrl === undefined
          ? {}
          : { canonicalUrl: resolved.provenance.canonicalUrl }),
        ...(resolved.provenance?.channel === undefined
          ? {}
          : { channel: resolved.provenance.channel }),
        ...(resolved.provenance?.thumbnailUrl === undefined
          ? {}
          : { thumbnailUrl: resolved.provenance.thumbnailUrl }),
        ...(resolved.durationSeconds === undefined
          ? {}
          : { durationSeconds: resolved.durationSeconds }),
      },
    });
  }
}

function requestStatusForExit(
  stateName: string,
  lastError: string | null,
): "completed" | "failed" | "skipped" {
  // The request table intentionally models skips/stops as terminal outcomes through the public
  // control methods. A card click dispatches directly, so the observer must preserve that intent
  // when the machine reaches its transient `skipped` or `leaving` state.
  if (stateName === "skipped") return "skipped";
  if (stateName === "leaving" && lastError === null) return "skipped";
  return lastError === null ? "completed" : "failed";
}
