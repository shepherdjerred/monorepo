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
 * Nothing infers this at runtime, and nothing may: an empty result is
 * indistinguishable from "nobody tracked has played it yet". That ambiguity
 * cuts both ways — it is why a user can spend hours on a competition that
 * could never fill, and why a quiet queue must never be marked `never` just
 * for being quiet. The test that settles it is pre-match games observed
 * against finished matches received: a queue Scout repeatedly watches start
 * and never sees end is withholding results, and a queue with neither is
 * merely unplayed. Each entry below records that count, and
 * `Record<QueueType, …>` makes a newly added queue a compile error rather
 * than a silent `available`.
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
  /**
   * Summoner's Rift Clash (queue 700). Finished Match-V5 payloads exist:
   * 27 in prod (2025-12-13 through 2026-02-07) and 10 in beta (2025-12-14
   * through 2026-01-25). Captured prod object
   * `games/2026/02/07/EUW1_7721480520/match.json` is MATCHED_GAME, complete,
   * and passes the matchmade field gate.
   *
   * Prematch continues after that window — prod 32 observations (2026-05-09
   * through 2026-09-20), beta 9 — and those spectator IDs do not overlap the
   * finished-match IDs. Live spectator payloads are `gameType: "CUSTOM"` with
   * queue 700; Match-V5 404s the spectator game id. Post-match discovery still
   * finds Clash through the unfiltered match list when Riot publishes a
   * MATCHED_GAME id, which is why this stays `available` rather than `never`.
   */
  clash: "available",
  /**
   * ARAM Clash (queue 720). Scout watches these start and never learns how
   * they ended. Prod holds 52 pre-match observations (2026-06-20 through
   * 2026-08-24) and 0 finished matches; beta holds 6 and 0. A month-old
   * spectator id (`NA1_5627356114`, archived
   * `prematch/2026/08/23/5627356114/spectator-data.json`) still 404s on
   * Match-V5. Same measurement as ARAM Mayhem, not a quiet queue.
   */
  "aram clash": "never",
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
   * Classic ARAM Mayhem is the weakest entry in this table and the one to
   * re-measure first.
   *
   * It demonstrably HAS published results: 20 finished matches in prod, 4 in
   * beta, and a captured prod Match-V5 payload for queue 2450 at
   * `postmatch/testdata/match-classic-aram-mayhem-s3.json` (from
   * `games/2026/07/29/BR1_3267199656/match.json`) with ten participants and
   * full per-player stats. So `never` would be a false claim.
   *
   * But every one of those 20 landed on 2026-07-29 and 2026-07-30, the mode's
   * first two days, and prod then observed 61 more games through 2026-08-24
   * with no result for any of them. Either Riot stopped publishing after
   * launch or Scout stopped ingesting; this table cannot tell which, and the
   * distinction matters — the second would be a bug to fix rather than a fact
   * to record. `available` is the honest reading of the evidence, and it is
   * still a promise that has not held since 2026-07-30.
   */
  "classic aram mayhem": "available",
  brawl: "available",
  /**
   * ARAM: Mayhem (queues 2400/3200/3220/3270). Scout watches these games start
   * and never learns how they ended. Measured against both report lakes:
   * prod holds 4,686 pre-match observations (4,628 of queue 2400, 42 of 3270,
   * 13 of 3200, 3 of 3220) and 0 finished matches; beta holds 964 and 0. The
   * most recent pre-match sighting is hours old, so this is a live, popular
   * mode whose results Riot simply does not publish — not a dormant one.
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
