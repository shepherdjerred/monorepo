import { shameMessage } from "@shepherdjerred/streambot/moderation/adult-block.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { CrashNotice } from "@shepherdjerred/streambot/machine/types.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";

/** Minimal projection of the machine snapshot the reporter needs. */
export type StatusSnapshot = {
  readonly state: string;
  /** Kind of the source being resolved — only local files get the slow-extraction notice. */
  readonly currentKind: Source["kind"] | null;
  /**
   * Label of the source currently being resolved, available before it resolves to a title (the
   * "now playing" title is null until `resolved` is set). Drives the "preparing…" notice.
   */
  readonly currentSourceLabel: string | null;
  readonly blockedNonce: number;
  readonly blockedRequester: UserId | null;
  /** Machine `lastError` — the reason playback stopped (external stop, failure), or null. */
  readonly lastError: string | null;
  /** One-shot crash/retry notice from the recovery ladder (deduped by nonce), or null. */
  readonly crashNotice: CrashNotice | null;
};

/** Cancels a pending scheduled notice. Returned by {@link NoticeScheduler}. */
export type CancelNotice = () => void;
/** Schedules `fn` to run after `ms`; returns a canceller. Injected so tests stay deterministic. */
export type NoticeScheduler = (fn: () => void, ms: number) => CancelNotice;

/** Default delay before a still-resolving file gets a "preparing…" notice (ms). */
const DEFAULT_RESOLVING_NOTICE_DELAY_MS = 4000;

/** "m:ss" / "h:mm:ss" from a position in seconds (floored). */
function formatTimecode(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${String(h)}:${mm}:${ss}` : `${mm}:${ss}`;
}

const defaultScheduler: NoticeScheduler = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  // Don't let a pending notice keep the process alive at shutdown.
  timer.unref();
  return () => {
    clearTimeout(timer);
  };
};

export type StatusReporterOptions = {
  readonly initialNonce?: number;
  /**
   * How long a local file may sit in `resolving` before a "preparing…" notice is posted. The notice
   * is cancelled if resolving finishes first, so fast paths (sidecar/cache hit) stay silent and only
   * genuinely slow embedded-subtitle extractions announce. Defaults to
   * {@link DEFAULT_RESOLVING_NOTICE_DELAY_MS}.
   */
  readonly resolvingNoticeDelayMs?: number;
  /** Timer injection for deterministic tests; defaults to global setTimeout/clearTimeout. */
  readonly schedule?: NoticeScheduler;
};

/**
 * Turns machine transitions into world-readable *notices* in the status channel: a slow file being
 * prepared, a crash being retried, why a stream stopped, and the cheeky shaming when an adult source
 * is blocked. Each is de-duped so a re-rendered snapshot doesn't spam. Wire `handle` into
 * `actor.subscribe(...)`.
 *
 * The "now playing" line is deliberately **not** here: it is the player card, a live message with
 * controls owned by `player-card-manager.ts`. This reporter only emits one-shot text.
 */
export class StatusReporter {
  private readonly announce: (message: string) => Promise<void>;
  private readonly schedule: NoticeScheduler;
  private readonly resolvingNoticeDelayMs: number;
  private lastNonce: number;
  /** State seen on the previous snapshot — detects the active→idle edge for stop announcements. */
  private lastState: string | null = null;
  /** Dedup key for the last stop-reason announcement (state edges can re-render). */
  private lastStopKey: string | null = null;
  /** Nonce of the last announced crash/retry notice (0 = none yet). */
  private lastCrashNonce = 0;
  /** Cancels the pending "preparing…" notice timer, or null when none is scheduled. */
  private cancelNotice: CancelNotice | null = null;
  /** Source label the current notice is scheduled/announced for — dedupes re-rendered snapshots. */
  private noticeKey: string | null = null;

  constructor(
    announce: (message: string) => Promise<void>,
    options: StatusReporterOptions = {},
  ) {
    this.announce = announce;
    this.lastNonce = options.initialNonce ?? 0;
    this.schedule = options.schedule ?? defaultScheduler;
    this.resolvingNoticeDelayMs =
      options.resolvingNoticeDelayMs ?? DEFAULT_RESOLVING_NOTICE_DELAY_MS;
  }

  handle(snapshot: StatusSnapshot): void {
    if (snapshot.blockedNonce !== this.lastNonce) {
      this.lastNonce = snapshot.blockedNonce;
      if (snapshot.blockedRequester !== null) {
        void this.announce(shameMessage(snapshot.blockedRequester));
      }
    }

    this.announceCrashNotice(snapshot);
    this.announceStopReason(snapshot);
    this.updateResolvingNotice(snapshot);
  }

  /**
   * While a local file sits in `resolving`, schedule a one-shot "preparing…" notice. It fires only
   * if resolving outlasts the delay — sidecar/cache-hit resolves finish first and cancel it, so a
   * notice appears only for the genuinely slow case (a full-demux embedded-subtitle extraction). yt-dlp
   * sources are excluded: their latency is download, not subtitle extraction. De-duped by source
   * label so a re-rendered `resolving` snapshot doesn't reschedule.
   */
  private updateResolvingNotice(snapshot: StatusSnapshot): void {
    const label =
      snapshot.state === "resolving" && snapshot.currentKind === "file"
        ? snapshot.currentSourceLabel
        : null;
    if (label === null) {
      // Left resolving (now streaming/failed/idle) or not a file — cancel any pending notice.
      this.clearNotice();
      return;
    }
    if (label === this.noticeKey) {
      return;
    }
    this.clearNotice();
    this.noticeKey = label;
    this.cancelNotice = this.schedule(() => {
      this.cancelNotice = null;
      void this.announce(
        `⏳ Preparing **${label}** — extracting subtitles from a large file, which can take ` +
          `up to a minute. Playback will start automatically when it's ready.`,
      );
    }, this.resolvingNoticeDelayMs);
  }

  /**
   * When playback stops with a recorded reason (external stop — voice loss, kick, guild removal),
   * say so instead of going silent. Fires once per active→idle edge that carries a `lastError`;
   * ordinary natural ends (lastError null) and user stops stay quiet as before.
   */
  private announceStopReason(snapshot: StatusSnapshot): void {
    const previousState = this.lastState;
    this.lastState = snapshot.state;
    if (snapshot.state !== "idle" || snapshot.lastError === null) {
      if (snapshot.state !== "idle") {
        this.lastStopKey = null;
      }
      return;
    }
    const wasActive =
      previousState !== null &&
      previousState !== "idle" &&
      previousState !== "waiting";
    if (!wasActive) {
      return;
    }
    const stopKey = `${previousState}:${snapshot.lastError}`;
    if (stopKey === this.lastStopKey) {
      return;
    }
    this.lastStopKey = stopKey;
    void this.announce(`⏹️ Stream stopped: ${snapshot.lastError}`);
  }

  /**
   * Announce the recovery ladder's work — a mid-stream crash/truncation/stall being retried, or a
   * give-up after the retry budget. Deduped by the notice nonce (each machine transition that
   * crashes bumps it exactly once), so re-rendered snapshots stay silent. Fires even when the
   * queue continues afterward — this is the fix for the silent `failed → skipped` path.
   */
  private announceCrashNotice(snapshot: StatusSnapshot): void {
    const notice = snapshot.crashNotice;
    if (notice === null || notice.nonce === this.lastCrashNonce) {
      return;
    }
    this.lastCrashNonce = notice.nonce;
    const at = formatTimecode(notice.positionSeconds);
    const what =
      notice.reason === "stall"
        ? "stalled"
        : notice.reason === "ended-short"
          ? "ended early"
          : "crashed";
    if (notice.kind === "retry") {
      const pipeline = notice.pipelineMode === "sw" ? "software" : "hardware";
      void this.announce(
        `⚠️ **${notice.title}** ${what} at ${at} — retrying from there ` +
          `(attempt ${String(notice.attempt)}/${String(notice.maxAttempts)}, ${pipeline})…`,
      );
      return;
    }
    void this.announce(
      `🛑 Gave up on **${notice.title}** after ${String(notice.maxAttempts)} retries ` +
        `(last ${what} at ${at}). Skipping it.`,
    );
  }

  /** Cancel any pending "preparing…" notice and clear its dedup key. */
  private clearNotice(): void {
    if (this.cancelNotice !== null) {
      this.cancelNotice();
      this.cancelNotice = null;
    }
    this.noticeKey = null;
  }
}
