import { fnv1a } from "@scout-for-lol/report";

/**
 * Pseudonymize player names in generated marketing assets.
 *
 * Why this exists: the competition chart's best source material is the beta
 * bucket (28 players across 107 snapshots, versus 3 in prod's richest
 * competition), but beta leaderboards carry real first names rather than in-game
 * handles. Rather than choose between a good chart and not publishing people's
 * names, every showcase chart renders pseudonyms.
 *
 * Scope note: `privacy.mdx` already permits real player data in marketing
 * artifacts, so this is a deliberate preference, not a compliance control. It is
 * also NOT unlinkability — `fnv1a` is unkeyed and brute-forceable over a name
 * dictionary. What ships is a PNG, and the mapping is never persisted, so that
 * is an acceptable trade. Do not repurpose this for anything where reversal
 * matters.
 *
 * The hard requirement is determinism. The showcase regenerates weekly and
 * commits the PNGs; a pseudonym that moved between runs would produce an image
 * diff and a junk PR every Monday.
 *
 * What that buys is narrower than "this player always draws this handle". A
 * handle is a function of the whole call sequence, not of one call's arguments:
 * the seed is `${stableKey}|${realName}`, and collisions are resolved by
 * probing past the handles already taken (see `createPlayerAnonymizer`). So the
 * guarantee is reproducibility — the same manifest, rendering the same rosters
 * in the same order, yields the same handles, run after run, which is what
 * keeps the committed PNGs stable. Anything that changes the inputs to that
 * sequence — a re-curation pointing an entry at a different object, a player
 * renaming, a change to how many players an entry renders — can move handles,
 * including for players who themselves did not change. That is a one-off image
 * diff to review on the Monday PR, not per-run churn.
 */

// Invented handles in the same register as the hand-authored Discord chrome in
// discord-templates.ts (`rangedtop`, `tankmommy`, `poromancer`). Deliberately
// larger than the 10 series a chart plots, so probing rarely walks far. Keep
// these obviously-fictional: they must not collide with a real summoner name.
const HANDLE_POOL: readonly string[] = [
  "rangedtop",
  "tankmommy",
  "poromancer",
  "baronsteal",
  "wardbot9000",
  "flashless",
  "smiteandrun",
  "lasthitter",
  "gankfromriver",
  "splitpushr",
  "objectivepig",
  "tiltproof",
  "sidelaneenjoy",
  "canyoupls",
  "midorfeed",
  "roamgod",
  "buffstealer",
  "towerdiver",
  "recallnow",
  "onetrickpony",
  "junglegap",
  "vsbotmain",
  "petricktrick",
  "scuttleclaim",
  "goldfunnel",
  "wardsplaced",
  "backdoorbob",
  "teamfightdiff",
  "cannonminion",
  "elderthief",
];

export type PlayerAnonymizer = (stableKey: string, realName: string) => string;

/**
 * Build a pseudonym mapper for one generation run.
 *
 * `stableKey` must be a non-display identity — `CachedLeaderboardEntry.playerId`
 * or `RawParticipant.puuid` — so a player who changes their display name does
 * not churn the committed image.
 *
 * Note those two key spaces do not overlap, so one human appearing in both the
 * competition chart (keyed on Scout's `playerId`) and the report chart (keyed on
 * Riot's `puuid`) draws two different handles. That is fine, and mildly
 * preferable: it makes the charts less cross-linkable.
 *
 * Callers should assign handles to the players they are actually going to
 * render, not to every player they aggregated — see the slice-then-anonymize
 * ordering in report-graph.ts.
 *
 * `realName` is used only as a last-resort disambiguator; it is never emitted.
 *
 * Collisions are resolved by linear probing over the pool, so an assignment
 * depends on which handles earlier calls took, not just on this call's seed.
 * Two runs over the same manifest still agree, because the manifest fixes entry
 * order, entries are generated serially, and each entry pins exact S3 object
 * keys — the roster behind an entry cannot move until a re-curation swaps that
 * key. That is the precondition, not an inherent property: change the roster or
 * the order and a player whose own seed did not change can still land on a
 * different handle. It is bounded: once the pool is exhausted, fall back to a
 * numbered handle rather than emitting a duplicate, because a duplicate would
 * silently merge two people in a legend.
 */
export function createPlayerAnonymizer(): PlayerAnonymizer {
  const assigned = new Map<string, string>();
  const taken = new Set<string>();

  return (stableKey: string, realName: string): string => {
    const existing = assigned.get(stableKey);
    if (existing !== undefined) {
      return existing;
    }

    // Mix the real name into the hash so two players who somehow share a stable
    // key still separate. The cache above is keyed on the stable key alone, so
    // within a run a rename cannot move a handle; across runs it can, because
    // the seed changes. A rename is not the only thing that can move a handle,
    // though — the probe below reads `taken`, so who was assigned earlier in
    // the run matters too. Both are one-off image diffs on the Monday PR rather
    // than per-run churn, because an unchanged manifest replays an unchanged
    // call sequence.
    const seed = fnv1a(`${stableKey}|${realName}`);
    for (let probe = 0; probe < HANDLE_POOL.length; probe += 1) {
      const candidate = HANDLE_POOL[(seed + probe) % HANDLE_POOL.length];
      if (candidate !== undefined && !taken.has(candidate)) {
        assigned.set(stableKey, candidate);
        taken.add(candidate);
        return candidate;
      }
    }

    const overflow = `player${(assigned.size + 1).toString()}`;
    assigned.set(stableKey, overflow);
    taken.add(overflow);
    return overflow;
  };
}
