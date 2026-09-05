import {
  ExploreMentionCandidateSchema,
  QueueTypeSchema,
  type ExploreMentionCandidate,
} from "@scout-for-lol/data";
import { browserChampions } from "@scout-for-lol/data/browser-assets.ts";

/**
 * The `@` mention picker's pure half: what the reader is currently typing,
 * which suggestions match it, and what the box should read afterwards.
 *
 * Kept out of the composer so the fiddly parts — caret arithmetic, where a
 * mention starts and ends, what counts as "still typing one" — are testable
 * without a DOM, matching how the rest of Explore's client state is split.
 *
 * The point of the feature is not saving keystrokes. `resolvePlayerRefPuuids`
 * *throws* when a name matches more than one player, and without a picker the
 * model spends a `resolve_player` round trip guessing which one was meant.
 * Choosing from a list inserts a form that resolves to exactly one person.
 */

export type MentionSpan = {
  /** What has been typed after the `@`, possibly empty. */
  query: string;
  /** Index of the `@` itself. */
  start: number;
  /** Index one past the last typed character. */
  end: number;
};

/** How many characters after `@` still count as one mention being typed. */
const MAX_MENTION_QUERY = 60;

/**
 * The mention the caret is inside, or null.
 *
 * An `@` only opens a mention at a word boundary, so an email address or a
 * Riot ID typed by hand does not turn the composer into a popover. A space
 * ends one: names contain spaces, but allowing them would mean every `@` for
 * the rest of the message stays "open", and the reader could never dismiss it
 * by typing on.
 */
export function activeMentionSpan(
  text: string,
  caret: number,
): MentionSpan | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) {
    return null;
  }
  const preceding = at === 0 ? "" : before.charAt(at - 1);
  if (preceding !== "" && !/\s/u.test(preceding)) {
    return null;
  }
  const query = before.slice(at + 1);
  if (query.length > MAX_MENTION_QUERY || /\s/u.test(query)) {
    return null;
  }
  return { query, start: at, end: caret };
}

/**
 * Suggestions that need no network call.
 *
 * Champions and queues are closed, client-side catalogs, so they answer on the
 * first keystroke while a player lookup — a DuckDB scan over the lake — is
 * still in flight. That ordering is deliberate: the popover is never empty
 * while it waits.
 */
export function staticMentionCandidates(
  query: string,
): ExploreMentionCandidate[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }
  const champions = browserChampions
    .filter((champion) => champion.name.toLowerCase().includes(needle))
    .map((champion) =>
      ExploreMentionCandidateSchema.parse({
        kind: "champion",
        label: champion.name,
        insertText: champion.name,
        detail: "champion",
      }),
    );
  const queues = QueueTypeSchema.options
    .filter((queue) => queue.includes(needle))
    .map((queue) =>
      ExploreMentionCandidateSchema.parse({
        kind: "queue",
        label: queue,
        insertText: queue,
        detail: "queue",
      }),
    );
  return [...champions, ...queues];
}

/**
 * Merge server-side players ahead of the static catalogs.
 *
 * Players first because they are the ambiguous ones — the whole reason to
 * pick rather than type — and because a champion or queue name typed by hand
 * already resolves at compile time with a did-you-mean.
 */
export function mergeMentionCandidates(
  players: ExploreMentionCandidate[],
  statics: ExploreMentionCandidate[],
  limit: number,
): ExploreMentionCandidate[] {
  const seen = new Set<string>();
  const merged: ExploreMentionCandidate[] = [];
  for (const candidate of [...players, ...statics]) {
    const key = `${candidate.kind}:${candidate.insertText.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
    if (merged.length === limit) break;
  }
  return merged;
}

/**
 * Replace the mention being typed with the chosen text.
 *
 * The `@` goes with it: it was a trigger for the picker, not part of the
 * question, and a question reading "how does @Jerred#NA1 do on Yasuo" would
 * hand the model a token it has to strip before it can resolve anything.
 *
 * A trailing space is appended so the reader carries straight on typing
 * without the just-closed mention immediately reopening — unless what follows
 * already starts with one, which happens whenever a mention is filled in
 * ahead of text that is already there.
 */
export function applyMention(
  text: string,
  span: MentionSpan,
  insertText: string,
): { text: string; caret: number } {
  const head = text.slice(0, span.start);
  const tail = text.slice(span.end);
  const inserted = /^\s/u.test(tail) ? insertText : `${insertText} `;
  return {
    text: `${head}${inserted}${tail}`,
    caret: span.start + inserted.length,
  };
}
