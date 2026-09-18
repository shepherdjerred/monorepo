import { QueueTypeSchema, type QueueType } from "#src/model/core/state.ts";

/**
 * Whether Scout can ever obtain finished-match data for a queue.
 *
 * This is a different fact from `queue-availability.ts`, which answers "is this
 * mode live right now". A mode can be live, announced, and playable while Riot
 * still exposes no Match-V5 payload for it — Scout sees the game start through
 * the Spectator API, renders a pre-match loading screen, and then never
 * receives a result. Every downstream number (win rates, standings, a
 * competition's score) is built from finished matches, so a queue marked
 * `never` here can produce a pre-match announcement and nothing else, forever.
 *
 * Nothing infers this at runtime: an empty result is indistinguishable from
 * "nobody tracked has played it yet", which is exactly the ambiguity that made
 * a user spend three hours designing an ARAM Mayhem competition against a
 * corpus that could never fill. The fact is declared, with its evidence, and
 * `Record<QueueType, …>` makes a newly added queue a compile error rather than
 * a silent `available`.
 *
 * When a queue moves — Riot starts publishing results for a mode, or stops —
 * change it here and cite what you checked.
 */
export type QueuePostMatchData =
  /** Riot publishes Match-V5 results; Scout ingests and can score them. */
  | "available"
  /** Pre-match only. Scout can announce the game and never learn the result. */
  | "never";

export const QUEUE_POST_MATCH_DATA: Record<QueueType, QueuePostMatchData> = {
  solo: "available",
  flex: "available",
  "ranked 5s": "available",
  clash: "available",
  "aram clash": "available",
  aram: "available",
  arurf: "available",
  urf: "available",
  quickplay: "available",
  swiftplay: "available",
  arena: "available",
  /**
   * League Classic: verified against prod — zero `classic` post-match objects
   * across 1,078 in its launch window, against 8 loading screens in the same
   * period. The marketing showcase already declares this mode pre-match only
   * for the same reason (`scripts/discover-marketing-showcase.ts`).
   */
  classic: "never",
  /**
   * Classic ARAM Mayhem DOES publish results, unlike the two neighbours it is
   * easily confused with: a real prod Match-V5 payload for queue 2450 is
   * captured at `postmatch/testdata/match-classic-aram-mayhem-s3.json` (from
   * `games/2026/07/29/BR1_3267199656/match.json`).
   */
  "classic aram mayhem": "available",
  brawl: "available",
  /**
   * ARAM: Mayhem (queues 2400/3200/3220/3270). Live since 2025-10-22, and in
   * that time prod has captured pre-match loading screens for it (for example
   * `prematch/2026/08/11/8336633521/`) and not one post-match object — the
   * showcase manifest records the post-match scan as a miss, and the report
   * lake holds zero `aram mayhem` rows across all ingested history.
   */
  "aram mayhem": "never",
  normal: "available",
  "draft pick": "available",
  "easy doom bots": "available",
  "normal doom bots": "available",
  "hard doom bots": "available",
  custom: "available",
};

export function queueHasPostMatchData(queue: QueueType): boolean {
  return QUEUE_POST_MATCH_DATA[queue] === "available";
}

/** Every queue Scout can only ever see pre-match, for prompts and pickers. */
export function queuesWithoutPostMatchData(): readonly QueueType[] {
  return QueueTypeSchema.options
    .filter((queue) => !queueHasPostMatchData(queue))
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Short note for a picker, alongside `queueAvailabilityNote`. Returns
 * undefined when the queue's results do arrive, so a caller can render both
 * notes and show only what applies.
 */
export function queuePostMatchNote(queue: QueueType): string | undefined {
  return queueHasPostMatchData(queue)
    ? undefined
    : "Pre-match only — Riot publishes no results for this mode, so it cannot be scored";
}
