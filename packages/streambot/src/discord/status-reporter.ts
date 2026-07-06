import { shameMessage } from "@shepherdjerred/streambot/moderation/adult-block.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import { parseTitleYear } from "@shepherdjerred/streambot/sources/normalize.ts";
import type { PosterFetcher } from "@shepherdjerred/streambot/metadata/tmdb.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";

/**
 * A world-readable announcement: either plain text, or text plus an embed (used to attach a movie/TV
 * poster to the now-playing line). Kept discord.js-free here; `command-bot.ts` renders the embed.
 */
export type Announcement =
  | string
  | {
      readonly content: string;
      readonly embed?: { readonly title?: string; readonly imageUrl?: string };
    };

/** Minimal projection of the machine snapshot the reporter needs. */
export type StatusSnapshot = {
  readonly state: string;
  readonly currentTitle: string | null;
  readonly currentRequester: UserId | null;
  /** Kind of the currently-playing source — posters are only fetched for local files. */
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
};

/** Cancels a pending scheduled notice. Returned by {@link NoticeScheduler}. */
export type CancelNotice = () => void;
/** Schedules `fn` to run after `ms`; returns a canceller. Injected so tests stay deterministic. */
export type NoticeScheduler = (fn: () => void, ms: number) => CancelNotice;

/** Default delay before a still-resolving file gets a "preparing…" notice (ms). */
const DEFAULT_RESOLVING_NOTICE_DELAY_MS = 4000;

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
  /** Optional poster lookup; when set, local-file now-playing lines get a poster embed. */
  readonly fetchPoster?: PosterFetcher;
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
 * Turns machine transitions into world-readable announcements in the status channel: "now playing"
 * when a stream starts (with a movie/TV poster for local files when a poster fetcher is configured),
 * and the cheeky shaming when an adult source is blocked. De-duped so a re-rendered snapshot doesn't
 * spam. Wire `handle` into `actor.subscribe(...)`.
 */
export class StatusReporter {
  private readonly announce: (message: Announcement) => Promise<void>;
  private readonly fetchPoster: PosterFetcher | undefined;
  private readonly schedule: NoticeScheduler;
  private readonly resolvingNoticeDelayMs: number;
  private lastNowKey: string | null = null;
  private lastNonce: number;
  /** State seen on the previous snapshot — detects the active→idle edge for stop announcements. */
  private lastState: string | null = null;
  /** Dedup key for the last stop-reason announcement (state edges can re-render). */
  private lastStopKey: string | null = null;
  /** Cancels the pending "preparing…" notice timer, or null when none is scheduled. */
  private cancelNotice: CancelNotice | null = null;
  /** Source label the current notice is scheduled/announced for — dedupes re-rendered snapshots. */
  private noticeKey: string | null = null;

  constructor(
    announce: (message: Announcement) => Promise<void>,
    options: StatusReporterOptions = {},
  ) {
    this.announce = announce;
    this.fetchPoster = options.fetchPoster;
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

    this.announceStopReason(snapshot);
    this.updateResolvingNotice(snapshot);

    const nowKey =
      snapshot.state === "streaming" && snapshot.currentTitle !== null
        ? snapshot.currentTitle
        : null;
    if (nowKey === null) {
      // Reset between songs so a looped/repeated track re-announces when it starts again.
      this.lastNowKey = null;
      return;
    }
    if (nowKey === this.lastNowKey) {
      return;
    }
    // Set the dedup key before the (async) poster fetch so a re-rendered snapshot can't double-post.
    this.lastNowKey = nowKey;

    const who =
      snapshot.currentRequester === null
        ? ""
        : ` (requested by <@${snapshot.currentRequester}>)`;
    const content = `▶️ Now playing **${nowKey}**${who}`;

    if (snapshot.currentKind === "file" && this.fetchPoster !== undefined) {
      const fetchPoster = this.fetchPoster;
      void (async () => {
        const { title, year } = parseTitleYear(nowKey);
        const poster = await fetchPoster(title, year);
        // The track may have changed while the poster fetch was in flight; don't post a stale
        // announcement out of order behind the newer track's message.
        if (this.lastNowKey !== nowKey) {
          return;
        }
        await this.announce(
          poster === null
            ? content
            : { content, embed: { title: nowKey, imageUrl: poster.posterUrl } },
        );
      })();
      return;
    }

    void this.announce(content);
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

  /** Cancel any pending "preparing…" notice and clear its dedup key. */
  private clearNotice(): void {
    if (this.cancelNotice !== null) {
      this.cancelNotice();
      this.cancelNotice = null;
    }
    this.noticeKey = null;
  }
}
