/**
 * Lifecycle of one session's player card: when to post a fresh card, when to edit the existing one,
 * when to re-post it because chat has buried it, and how to leave it behind when the session ends.
 *
 * Deliberately discord.js-free — every Discord effect goes through the injected {@link PlayerCardPort}
 * (implemented in `player-card-message.ts`) and the current state is read through an injected
 * `view()`. That keeps the interesting behavior — track-change detection, the async-poster
 * out-of-order guard, re-post counting, edit de-duplication — unit-testable with fakes, the same way
 * `StatusReporter` is.
 *
 * Card ownership rules:
 * - A new card is posted when a *different* title reaches `streaming`. The previous card keeps its
 *   text as channel history but loses its controls, so only one live card exists per session.
 * - Non-streaming states (joining, resolving after a subtitle change, a crash retry) re-render the
 *   existing card rather than replacing it — the same track is still in play.
 * - Re-posting for scroll-out deletes the old message instead of stripping it, since it is the same
 *   card simply moved down the channel; leaving it would read as a duplicate.
 */
import { parseTitleYear } from "@shepherdjerred/streambot/sources/normalize.ts";
import type { PosterFetcher } from "@shepherdjerred/streambot/metadata/tmdb.ts";
import {
  renderPlayerCard,
  type PlayerCardPayload,
} from "@shepherdjerred/streambot/discord/player-card.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/queue-text.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

const log = logger.child("player-card");

/** Which session a posted card belongs to, so a button click can be routed back to it. */
export type CardOwner = {
  readonly guildId: GuildId;
  readonly voiceChannelId: ChannelId;
};

/** The Discord side-effects the manager needs. Implemented by `player-card-message.ts`. */
export type PlayerCardPort = {
  /**
   * Post a card and register `owner` against the new message id for click routing. Resolves with
   * the message id, or null when the channel is missing or unsendable.
   */
  post: (
    channelId: ChannelId,
    payload: PlayerCardPayload,
    owner: CardOwner,
  ) => Promise<string | null>;
  /** Edit a card in place. Resolves false when the message is gone (deleted by a moderator). */
  edit: (
    channelId: ChannelId,
    messageId: string,
    payload: PlayerCardPayload,
  ) => Promise<boolean>;
  /** Drop a card's components and unregister it, leaving the message as history. */
  strip: (channelId: ChannelId, messageId: string) => Promise<void>;
  /** Delete a card outright and unregister it. */
  remove: (channelId: ChannelId, messageId: string) => Promise<void>;
  /**
   * Point a live card at a (possibly new) owner. `post` registers automatically; this exists for
   * re-registration after a moderator drags the streamer to another voice channel.
   */
  register: (messageId: string, owner: CardOwner) => void;
  /** Stop routing clicks for a message, without touching the message itself. */
  unregister: (messageId: string) => void;
};

/**
 * A port that does nothing, for harnesses with no status channel to post into — the live e2e runs
 * and the session-manager unit tests, both of which exercise playback rather than presentation.
 */
export const NOOP_CARD_PORT: PlayerCardPort = {
  post: () => Promise.resolve(null),
  edit: () => Promise.resolve(false),
  strip: () => Promise.resolve(),
  remove: () => Promise.resolve(),
  register: () => {
    /* no card is ever posted, so there is nothing to route */
  },
  unregister: () => {
    /* see register */
  },
};

/** Starts a repeating timer and returns its canceller. Injected so tests stay deterministic. */
export type IntervalScheduler = (fn: () => void, ms: number) => () => void;

const defaultScheduler: IntervalScheduler = (fn, ms) => {
  const timer = setInterval(fn, ms);
  // A ticking card must never hold the process open at shutdown.
  timer.unref();
  return () => {
    clearInterval(timer);
  };
};

export type PlayerCardManagerDeps = {
  readonly owner: CardOwner;
  /** Text channel the card is posted to; null (a resume with no known status channel) disables it. */
  readonly statusChannelId: ChannelId | null;
  readonly port: PlayerCardPort;
  /** Current playback state — read on every refresh and on every tick. */
  readonly view: () => PlaybackView;
  readonly enabled: boolean;
  /** Re-render cadence in ms; `0` disables ticking (state changes still re-render). */
  readonly tickMs: number;
  /** Re-post once this many messages land beneath the card; `0` disables re-posting. */
  readonly repostAfterMessages: number;
  /** Optional TMDB poster lookup; local files only, best-effort. */
  readonly fetchPoster?: PosterFetcher;
  readonly schedule?: IntervalScheduler;
};

export class PlayerCardManager {
  private readonly deps: PlayerCardManagerDeps;
  /** Session this card's clicks route to. Mutable: a session can be moved between voice channels. */
  private owner: CardOwner;
  /** Message id of the live card, or null when none has been posted yet. */
  private messageId: string | null = null;
  /** Title of the track the live card is for — the new-card trigger. */
  private trackKey: string | null = null;
  /** Poster for {@link trackKey}, once the (async) lookup returns. */
  private posterUrl: string | null = null;
  /** Serialized JSON of the last payload sent, so an unchanged render skips the REST edit. */
  private lastPayloadJson: string | null = null;
  /** Messages posted to the status channel since the card was last (re-)posted. */
  private messagesSinceCard = 0;
  private finished = false;
  private cancelTick: (() => void) | null = null;
  /**
   * Tail of the serialized Discord-effect chain. Posting, editing, and re-posting all mutate
   * `messageId`, so they must not interleave — two concurrent posts would strand a live card with
   * working buttons and no owner tracking it.
   */
  private tail: Promise<void> = Promise.resolve();

  constructor(deps: PlayerCardManagerDeps) {
    this.deps = deps;
    this.owner = deps.owner;
    if (deps.enabled && deps.statusChannelId !== null && deps.tickMs > 0) {
      const schedule = deps.schedule ?? defaultScheduler;
      this.cancelTick = schedule(() => {
        this.refresh();
      }, deps.tickMs);
    }
  }

  /**
   * Reconcile the card against current playback state. Called from the session's actor subscription
   * (state changed) and from the tick (position advanced).
   */
  refresh(): void {
    if (this.finished || this.deps.statusChannelId === null) {
      return;
    }
    const view = this.deps.view();
    const nowKey =
      view.state === "streaming" && view.current !== null
        ? view.current.title
        : null;

    if (nowKey !== null && nowKey !== this.trackKey) {
      this.beginTrack(nowKey, view);
      return;
    }
    if (this.trackKey === null) {
      // Nothing has started streaming yet — there is no card to keep up to date.
      return;
    }
    this.enqueue(() => this.renderExisting(this.deps.view()));
  }

  /**
   * The session moved to another voice channel (a moderator dragged the streamer). Re-point the
   * live card's routing entry, or its buttons would answer "That stream has ended" while the stream
   * is still playing at the new location.
   */
  reown(voiceChannelId: ChannelId): void {
    this.owner = { guildId: this.owner.guildId, voiceChannelId };
    if (this.messageId !== null) {
      this.deps.port.register(this.messageId, this.owner);
    }
  }

  /**
   * A message landed in the status channel. Counts toward burying the card — except the card's own
   * post, which arrives on this same event.
   */
  onChannelMessage(messageId: string): void {
    if (
      this.finished ||
      this.messageId === null ||
      messageId === this.messageId ||
      this.deps.repostAfterMessages <= 0
    ) {
      return;
    }
    this.messagesSinceCard += 1;
    if (this.messagesSinceCard >= this.deps.repostAfterMessages) {
      this.messagesSinceCard = 0;
      this.enqueue(() => this.repost(this.deps.view()));
    }
  }

  /**
   * Session over: render a final, control-less card so the last thing in the channel reflects
   * reality instead of offering buttons that would answer "That stream has ended."
   */
  async finalize(): Promise<void> {
    if (this.finished) {
      return;
    }
    this.finished = true;
    if (this.cancelTick !== null) {
      this.cancelTick();
      this.cancelTick = null;
    }
    const channelId = this.deps.statusChannelId;
    const messageId = this.messageId;
    if (channelId === null || messageId === null) {
      return;
    }
    const payload = this.render(this.deps.view());
    this.enqueue(async () => {
      // The finished payload already carries no components, so this single edit both retires the
      // controls and states the outcome. Routing is dropped separately — the message stays as history.
      await this.deps.port.edit(channelId, messageId, payload);
      this.deps.port.unregister(messageId);
    });
    await this.tail;
  }

  /** A brand-new title started streaming: retire the old card and post a fresh one. */
  private beginTrack(nowKey: string, view: PlaybackView): void {
    const previousMessageId = this.messageId;
    this.trackKey = nowKey;
    this.posterUrl = null;
    this.lastPayloadJson = null;
    this.messageId = null;
    this.messagesSinceCard = 0;
    this.startPosterLookup(nowKey, view);

    const channelId = this.deps.statusChannelId;
    if (channelId === null) {
      return;
    }
    this.enqueue(async () => {
      if (previousMessageId !== null) {
        await this.deps.port.strip(channelId, previousMessageId);
      }
      await this.postCard(channelId, this.deps.view());
    });
  }

  /**
   * Best-effort TMDB poster for a local file. The lookup outlives the track when playback moves on,
   * so the result is discarded unless the track it was requested for is still the live one —
   * otherwise a slow lookup would paste the previous movie's poster onto the current card.
   */
  private startPosterLookup(nowKey: string, view: PlaybackView): void {
    const fetchPoster = this.deps.fetchPoster;
    if (fetchPoster === undefined || view.current?.kind !== "file") {
      return;
    }
    void (async () => {
      const { title, year } = parseTitleYear(nowKey);
      try {
        const poster = await fetchPoster(title, year);
        if (poster === null || this.trackKey !== nowKey || this.finished) {
          return;
        }
        this.posterUrl = poster.posterUrl;
        this.refresh();
      } catch (error) {
        log.warn("poster lookup failed", { error: getErrorMessage(error) });
      }
    })();
  }

  private render(view: PlaybackView): PlayerCardPayload {
    return renderPlayerCard({
      view,
      posterUrl: this.posterUrl,
      enabled: this.deps.enabled,
      finished: this.finished,
    });
  }

  private async postCard(
    channelId: ChannelId,
    view: PlaybackView,
  ): Promise<void> {
    const payload = this.render(view);
    const posted = await this.deps.port.post(channelId, payload, this.owner);
    // With the card disabled these are one-shot plain announcements — nothing to edit or track.
    if (!this.deps.enabled) {
      return;
    }
    this.messageId = posted;
    this.lastPayloadJson = posted === null ? null : JSON.stringify(payload);
  }

  /** Re-render the live card, skipping the REST call when nothing visible changed. */
  private async renderExisting(view: PlaybackView): Promise<void> {
    const channelId = this.deps.statusChannelId;
    const messageId = this.messageId;
    if (channelId === null || messageId === null || !this.deps.enabled) {
      return;
    }
    const payload = this.render(view);
    const json = JSON.stringify(payload);
    if (json === this.lastPayloadJson) {
      return;
    }
    const edited = await this.deps.port.edit(channelId, messageId, payload);
    if (edited) {
      this.lastPayloadJson = json;
      return;
    }
    // The card was deleted out from under us; put a fresh one back so controls stay reachable.
    log.info("player card vanished — re-posting", { channelId });
    this.messageId = null;
    this.lastPayloadJson = null;
    await this.postCard(channelId, view);
  }

  /** Chat has buried the card: delete it and post the same card at the bottom of the channel. */
  private async repost(view: PlaybackView): Promise<void> {
    const channelId = this.deps.statusChannelId;
    const messageId = this.messageId;
    if (channelId === null || messageId === null || !this.deps.enabled) {
      return;
    }
    this.messageId = null;
    this.lastPayloadJson = null;
    await this.deps.port.remove(channelId, messageId);
    await this.postCard(channelId, view);
  }

  /**
   * Chain a Discord effect onto the serialized tail. Failures are logged and swallowed here rather
   * than propagated: a card is cosmetic, and an unhandled rejection from a fire-and-forget timer
   * would take the process down.
   */
  private enqueue(fn: () => Promise<void>): void {
    const previous = this.tail;
    this.tail = (async () => {
      // `previous` is already total (this same wrapper swallowed its failure), so awaiting it
      // sequences the chain without ever rejecting.
      await previous;
      try {
        await fn();
      } catch (error) {
        log.warn("player card update failed", {
          error: getErrorMessage(error),
        });
      }
    })();
  }
}
