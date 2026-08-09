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

/**
 * Outcome of editing a card. The three cases need different handling, which is why this isn't a
 * boolean: `gone` means re-post, while `failed` (a transient 5xx, a rate limit) must NOT be cached
 * as delivered or an unchanged later render would skip the retry and strand a stale card.
 */
export type CardEditResult = "ok" | "gone" | "failed";

/** The Discord side-effects the manager needs. Implemented by `player-card-message.ts`. */
export type PlayerCardPort = {
  /**
   * Post a card. A non-null `owner` registers the new message id for click routing; `null` posts a
   * message with no controls to route (the legacy announcement used when the card is disabled), so
   * the routing table doesn't accumulate entries nothing will ever clean up. Resolves with the
   * message id, or null when the channel is missing or unsendable.
   */
  post: (
    channelId: ChannelId,
    payload: PlayerCardPayload,
    owner: CardOwner | null,
  ) => Promise<string | null>;
  edit: (
    channelId: ChannelId,
    messageId: string,
    payload: PlayerCardPayload,
  ) => Promise<CardEditResult>;
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
  edit: () => Promise.resolve("gone"),
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
    const streaming =
      view.state === "streaming" && view.current !== null ? view.current : null;

    if (streaming !== null && streaming.sourceId !== this.trackKey) {
      this.beginTrack(streaming.sourceId, streaming.title, view);
      return;
    }
    if (this.trackKey === null) {
      // Nothing has started streaming yet — there is no card to keep up to date.
      return;
    }
    // Playback has moved on to the NEXT item but it hasn't started streaming yet (the machine
    // exposes it as `current` while resolving). Re-rendering now would rewrite this card with the
    // next track's title, and `beginTrack` would then strip that rewritten card and post another —
    // leaving two cards for the new track and none for the old. Leave the card alone until the new
    // item actually starts. `current === null` (waiting/idle/leaving) still renders, so the card
    // reflects the session going quiet.
    if (view.current !== null && view.current.sourceId !== this.trackKey) {
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
      // controls and states the outcome. Routing is dropped either way — the message stays as history.
      const result = await this.deps.port.edit(channelId, messageId, payload);
      if (result === "failed") {
        // The full edit didn't land and there is no session left to retry it, which would leave
        // live-looking buttons on a dead card. Fall back to the smaller components-only edit.
        await this.deps.port.strip(channelId, messageId);
        return;
      }
      this.deps.port.unregister(messageId);
    });
    await this.tail;
  }

  /** A brand-new item started streaming: retire the old card and post a fresh one. */
  private beginTrack(
    sourceId: string,
    title: string,
    view: PlaybackView,
  ): void {
    const previousMessageId = this.messageId;
    this.trackKey = sourceId;
    this.posterUrl = null;
    this.lastPayloadJson = null;
    this.messageId = null;
    this.messagesSinceCard = 0;

    const channelId = this.deps.statusChannelId;
    if (channelId === null) {
      return;
    }

    if (!this.deps.enabled) {
      // Legacy announcement: exactly one message per track, never edited. The poster therefore has
      // to be in hand *before* posting — the card path attaches it with a later edit, which this
      // mode has no message to perform. This mirrors the pre-card `StatusReporter` behavior.
      this.enqueue(async () => {
        const posterUrl = await this.lookupPoster(sourceId, title, view);
        if (this.trackKey !== sourceId) {
          return;
        }
        this.posterUrl = posterUrl;
        await this.postCard(channelId, view);
      });
      return;
    }

    this.startPosterLookup(sourceId, title, view);
    this.enqueue(async () => {
      if (previousMessageId !== null) {
        await this.deps.port.strip(channelId, previousMessageId);
      }
      await this.postCard(channelId, this.deps.view());
    });
  }

  /**
   * Best-effort TMDB poster for a local file, or null when none applies. Never throws — a missing
   * poster is cosmetic and must not break the card.
   */
  private async lookupPoster(
    sourceId: string,
    trackTitle: string,
    view: PlaybackView,
  ): Promise<string | null> {
    const fetchPoster = this.deps.fetchPoster;
    if (fetchPoster === undefined || view.current?.kind !== "file") {
      return null;
    }
    const { title, year } = parseTitleYear(trackTitle);
    try {
      const poster = await fetchPoster(title, year);
      return this.trackKey === sourceId ? (poster?.posterUrl ?? null) : null;
    } catch (error) {
      log.warn("poster lookup failed", {
        sourceId,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Kick off the poster lookup for the live card and fold the result in when it lands. The lookup
   * outlives the track when playback moves on, so the result is discarded unless the item it was
   * requested for is still the live one — otherwise a slow lookup would paste the previous movie's
   * poster onto the current card.
   */
  private startPosterLookup(
    sourceId: string,
    title: string,
    view: PlaybackView,
  ): void {
    void (async () => {
      const posterUrl = await this.lookupPoster(sourceId, title, view);
      if (posterUrl === null || this.trackKey !== sourceId || this.finished) {
        return;
      }
      this.posterUrl = posterUrl;
      this.refresh();
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
    // A disabled card is a one-shot announcement with no controls: post it unowned so the routing
    // table doesn't collect entries that nothing will ever clean up, and don't track it for edits.
    const posted = await this.deps.port.post(
      channelId,
      payload,
      this.deps.enabled ? this.owner : null,
    );
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
    const result = await this.deps.port.edit(channelId, messageId, payload);
    if (result === "ok") {
      this.lastPayloadJson = json;
      return;
    }
    if (result === "failed") {
      // Transient (rate limit / 5xx). Deliberately do NOT cache `json`: caching an undelivered
      // payload would make the next identical render a no-op and strand the card showing stale
      // state forever — which is exactly what happens with ticking off or a stationary view.
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
