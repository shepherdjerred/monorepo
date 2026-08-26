/**
 * Reviewed presentation-only snapshot. The Explore aggregate came from the
 * Beta report lake; the profile shape came from the local combined-account
 * fixture. All person, guild, alias, and Riot identities are pseudonyms.
 */
export const CONSUMER_PREVIEW = {
  snapshotDate: "2026-08-24",
  explore: {
    question: "Which champions have the highest win rate?",
    answer:
      "Across all Scout-ingested matches and queues, Renata leads champions with at least 20 recorded games.",
    leaders: [
      { champion: "Renata", winRate: "59.3%", games: 140 },
      { champion: "Zyra", winRate: "57.0%", games: 447 },
      { champion: "Brand", winRate: "56.4%", games: 731 },
    ],
    caveat:
      "Scout's corpus is not the full League ladder, and smaller samples can move quickly.",
    followUp: "Which champions lead in ranked solo only?",
  },
  profile: {
    guild: "Rift Study Group",
    alias: "Northstar",
    accounts: [
      {
        riotId: "MapleCarry#NOVA",
        queue: "Solo / duo",
        rank: "Gold II · 64 LP",
      },
      {
        riotId: "RiverQuartz#MINT",
        queue: "Flex",
        rank: "Gold IV · 2 LP",
      },
    ],
    recentForm: "2W · 2L",
    champions: [
      { name: "Jinx", games: 2 },
      { name: "Janna", games: 2 },
    ],
  },
} as const;
