import type {
  DiscoveryScope,
  MediaCandidate,
} from "@shepherdjerred/streambot/discovery/candidate.ts";
import {
  historyReferenceQuery,
  isHistoryReference,
} from "@shepherdjerred/streambot/discovery/media-intent.ts";

const CONTEXT_TTL_MS = 5 * 60 * 1000;

type ContextEntry = {
  readonly scope: DiscoveryScope;
  readonly expiresAt: number;
  readonly candidates: readonly MediaCandidate[];
  readonly lastResult?: MediaCandidate;
  readonly followUps: number;
};

function keyOf(scope: DiscoveryScope): string {
  return `${scope.guildId}:${scope.channelId}:${scope.userId}`;
}

/** Bounded in-memory conversational state; it never stores transcripts or audio. */
export class ConversationContextStore {
  private readonly entries = new Map<string, ContextEntry>();

  constructor(private readonly now: () => number = Date.now) {}

  rememberCandidates(
    scope: DiscoveryScope,
    candidates: readonly MediaCandidate[],
  ): void {
    this.entries.set(keyOf(scope), {
      scope,
      candidates: candidates.slice(0, 5),
      expiresAt: this.now() + CONTEXT_TTL_MS,
      followUps: 0,
    });
  }

  rememberResult(scope: DiscoveryScope, candidate: MediaCandidate): void {
    this.entries.set(keyOf(scope), {
      scope,
      candidates: [],
      lastResult: candidate,
      expiresAt: this.now() + CONTEXT_TTL_MS,
      followUps: 0,
    });
  }

  select(scope: DiscoveryScope, reference: string): MediaCandidate | null {
    const entry = this.get(scope);
    if (entry === null) return null;
    const ordinal = new Map([
      ["first", 0],
      ["one", 0],
      ["second", 1],
      ["two", 1],
      ["third", 2],
      ["three", 2],
      ["fourth", 3],
      ["four", 3],
      ["fifth", 4],
      ["five", 4],
    ]);
    const normalized = reference.toLocaleLowerCase("en-US");
    for (const [word, index] of ordinal) {
      if (new RegExp(String.raw`\b${word}\b`, "u").test(normalized)) {
        return entry.candidates[index] ?? null;
      }
    }
    const tokenMatch = entry.candidates.find(
      (candidate) => candidate.token === reference,
    );
    if (tokenMatch !== undefined) return tokenMatch;
    const titleMatch = entry.candidates.find((candidate) =>
      candidate.title.toLocaleLowerCase("en-US").includes(normalized),
    );
    if (titleMatch !== undefined) return titleMatch;
    if (!isHistoryReference(reference)) return null;
    const subject = historyReferenceQuery(reference).toLocaleLowerCase("en-US");
    const remembered = [entry.lastResult, ...entry.candidates].find(
      (candidate) =>
        candidate !== undefined &&
        (subject === "" ||
          candidate.title.toLocaleLowerCase("en-US").includes(subject)),
    );
    return remembered ?? null;
  }

  claimFollowUp(scope: DiscoveryScope): boolean {
    const entry = this.get(scope);
    if (entry === null || entry.followUps >= 2) return false;
    this.entries.set(keyOf(scope), {
      ...entry,
      followUps: entry.followUps + 1,
    });
    return true;
  }

  private get(scope: DiscoveryScope): ContextEntry | null {
    const key = keyOf(scope);
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }
}
