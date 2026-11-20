/**
 * Opaque identities for queue entries, so a remote client can say "the item I was looking at"
 * without the server exposing a path, URL or request id.
 *
 * A token is a random UUID bound to one queue-entry object. The pure machine keeps that object
 * when it dequeues an entry, but rebuilds `current` when it resolves, retries after a crash or
 * restarts with new subtitles. {@link currentItemToken} carries the token across those rebuilds by
 * comparing the fields the machine copies verbatim, so the same request keeps one token from queue
 * to finish, while two requests for identical media always get two tokens. Nothing here is
 * persisted: after a restart every entry receives a new token, which a stale client sees as a
 * finished item.
 */
import type {
  PlaybackContext,
  QueuedSource,
} from "@shepherdjerred/streambot/machine/types.ts";

type TokenContext = Pick<PlaybackContext, "current" | "queue" | "resolved">;

const tokens = new WeakMap<QueuedSource, string>();
const currents = new WeakMap<object, QueuedSource>();

function tokenOf(entry: QueuedSource): string {
  let token = tokens.get(entry);
  if (token === undefined) {
    token = crypto.randomUUID();
    tokens.set(entry, token);
  }
  return token;
}

/** A rebuilt `current` keeps requester, timestamps, request row and display object by reference. */
function continues(
  previous: QueuedSource,
  next: QueuedSource,
  resolved: PlaybackContext["resolved"],
): boolean {
  if (
    previous.requesterId !== next.requesterId ||
    previous.queuedAt !== next.queuedAt ||
    previous.requestId !== next.requestId
  )
    return false;
  return previous.display === undefined
    ? next.display === undefined &&
        (next.source === previous.source ||
          next.source === resolved?.playbackSource)
    : next.display === previous.display;
}

/**
 * The token of the entry now playing. `owner` is the playback actor; calling this for every
 * snapshot (the session observer does) is what lets a rebuilt entry inherit its token.
 */
export function currentItemToken(
  owner: object,
  context: Pick<TokenContext, "current" | "resolved">,
): string | null {
  const current = context.current;
  if (current === null) {
    currents.delete(owner);
    return null;
  }
  const previous = currents.get(owner);
  if (
    previous !== undefined &&
    previous !== current &&
    !tokens.has(current) &&
    continues(previous, current, context.resolved)
  )
    tokens.set(current, tokenOf(previous));
  currents.set(owner, current);
  return tokenOf(current);
}

export type ItemTokens = {
  readonly current: string | null;
  /** One token per queued entry, in queue order. */
  readonly queue: readonly string[];
};

export function itemTokens(owner: object, context: TokenContext): ItemTokens {
  return {
    current: currentItemToken(owner, context),
    queue: context.queue.map((entry) => tokenOf(entry)),
  };
}

/** Where a dispatched entry landed: `0` is playing or starting now, `n` has `n` entries ahead. */
export type DispatchedItem = {
  readonly token: string;
  readonly position: number;
};

export function queueEntries(context: TokenContext): ReadonlySet<QueuedSource> {
  return new Set(
    context.current === null
      ? context.queue
      : [context.current, ...context.queue],
  );
}

/**
 * Finds the first entry a synchronous dispatch added. `before` comes from {@link queueEntries}
 * immediately before the dispatch; any object not in it was created by that event.
 */
export function locateDispatched(
  owner: object,
  before: ReadonlySet<QueuedSource>,
  context: TokenContext,
): DispatchedItem | null {
  if (context.current !== null && !before.has(context.current)) {
    const token = currentItemToken(owner, context);
    return token === null ? null : { token, position: 0 };
  }
  const index = context.queue.findIndex((entry) => !before.has(entry));
  const entry = context.queue[index];
  if (entry === undefined) return null;
  return {
    token: tokenOf(entry),
    position: index + (context.current === null ? 0 : 1),
  };
}

const MAX_PENDING_STARTS = 64;
const pendingStarts = new Map<string, () => void>();

/**
 * Runs `onStart` once when the entry with `token` begins streaming. The map is bounded by size
 * rather than by timers: an entry that is skipped or fails before streaming is evicted by later
 * requests, oldest first.
 */
export function awaitPlaybackStart(token: string, onStart: () => void): void {
  if (!pendingStarts.has(token) && pendingStarts.size >= MAX_PENDING_STARTS) {
    const oldest = pendingStarts.keys().next();
    if (oldest.done !== true) pendingStarts.delete(oldest.value);
  }
  pendingStarts.set(token, onStart);
}

export function pendingPlaybackStarts(): number {
  return pendingStarts.size;
}

/** Called by the session observer for every actor snapshot. */
export function observePlaybackItem(
  owner: object,
  stateName: string,
  context: Pick<TokenContext, "current" | "resolved">,
): void {
  const token = currentItemToken(owner, context);
  if (token === null || stateName !== "streaming") return;
  const onStart = pendingStarts.get(token);
  if (onStart === undefined) return;
  pendingStarts.delete(token);
  onStart();
}
