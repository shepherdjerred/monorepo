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
 * diff and a junk PR every Monday. Every output is therefore a pure function of
 * the caller's stable key.
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
 * Collisions are resolved by linear probing over the pool. That makes the result
 * order-dependent *within* a run, which is safe because the manifest fixes entry
 * order and entries are generated serially — two runs over the same manifest see
 * identical key order. It is bounded: once the pool is exhausted, fall back to a
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
    // key still separate, while a rename alone (same key) cannot move the
    // handle — the cache above already returned for that case.
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
