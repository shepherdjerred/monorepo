import type { MetaRole } from "@scout-for-lol/data/meta/meta-serving.ts";
import { roleLabel, roleSlug } from "#src/lib/champion-meta/snapshot.ts";
import type {
  SnapshotChampion,
  SnapshotIndex,
} from "#src/lib/champion-meta/snapshot-v2-schema.ts";

/**
 * One card per champion and role on the champions index. Everything is plain
 * data so the controls island can take it as props; rates are percent.
 */

export type IndexCard = {
  id: number;
  name: string;
  href: string;
  role: MetaRole;
  /** "Mid". */
  roleName: string;
  /** The lane icon key the design system draws. */
  laneIcon: string;
  /** The champion's most played role: the one "All" shows. */
  main: boolean;
  winRate: number;
  games: number;
  tier: string;
  tierRank: number;
  lane: { aheadRate: number; games: number } | null;
};

const LANE_ICONS: Record<MetaRole, string> = {
  TOP: "top",
  JUNGLE: "jungle",
  MIDDLE: "middle",
  BOTTOM: "adc",
  UTILITY: "support",
};

const TIERS = ["S", "A", "B", "C", "D"] as const;

export function laneIconFor(role: MetaRole): string {
  return LANE_ICONS[role];
}

function tierRank(tier: (typeof TIERS)[number]): number {
  return TIERS.indexOf(tier);
}

type LaneFigure = IndexCard["lane"];

/** The lane figure of one champion's role slice; null when it served none. */
function laneOf(champion: SnapshotChampion, role: MetaRole): LaneFigure {
  const slice = champion.slices.find(
    (candidate) => candidate.context.role === role,
  );
  if (slice === undefined) {
    throw new Error(`${champion.slug} has no ${role} slice`);
  }
  return slice.lane === undefined
    ? null
    : { aheadRate: slice.lane.aheadRate.value * 100, games: slice.lane.games };
}

/**
 * Cards in the default order: strongest first. The index file carries every
 * headline; the lane figures live in the champion files, so a caller that
 * wants them passes the loaded champions and one that does not passes `null`.
 */
export function indexCards(
  index: SnapshotIndex,
  champions: readonly SnapshotChampion[] | null,
): IndexCard[] {
  const bySlug = new Map(
    (champions ?? []).map((champion) => [champion.slug, champion]),
  );
  const cards = index.champions.flatMap((listed) => {
    const champion = bySlug.get(listed.slug);
    if (champions !== null && champion === undefined) {
      throw new Error(`Champion ${listed.slug} is not loaded`);
    }
    return listed.roles.map((entry, position): IndexCard => {
      return {
        id: listed.id,
        name: listed.name,
        href: `/champions/${listed.slug}/${roleSlug(entry.role)}/`,
        role: entry.role,
        roleName: roleLabel(entry.role),
        laneIcon: laneIconFor(entry.role),
        main: position === 0,
        winRate: entry.winRate.value * 100,
        games: entry.games,
        tier: entry.tier,
        tierRank: tierRank(entry.tier),
        lane: champion === undefined ? null : laneOf(champion, entry.role),
      };
    });
  });
  return sortCards(cards, "strongest");
}

export type IndexSort = "strongest" | "lane";
export type IndexRole = "all" | MetaRole;

export function sortCards(
  cards: readonly IndexCard[],
  sort: IndexSort,
): IndexCard[] {
  const byName = (a: IndexCard, b: IndexCard) => a.name.localeCompare(b.name);
  if (sort === "strongest") {
    return cards.toSorted(
      (a, b) =>
        a.tierRank - b.tierRank ||
        b.winRate - a.winRate ||
        b.games - a.games ||
        byName(a, b),
    );
  }
  return cards.toSorted((a, b) => {
    if (a.lane === null || b.lane === null) {
      if (a.lane === b.lane) return byName(a, b);
      return a.lane === null ? 1 : -1;
    }
    return b.lane.aheadRate - a.lane.aheadRate || byName(a, b);
  });
}

function searchKey(value: string): string {
  return value
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "");
}

/** What the index shows for a role, a search and a sort. */
export function visibleCards(
  cards: readonly IndexCard[],
  choice: { sort: IndexSort; role: IndexRole; query: string },
): IndexCard[] {
  const wanted = searchKey(choice.query);
  const inRole = cards.filter((card) =>
    choice.role === "all" ? card.main : card.role === choice.role,
  );
  const found =
    wanted === ""
      ? inRole
      : inRole.filter((card) => searchKey(card.name).includes(wanted));
  return sortCards(found, choice.sort);
}

/** "Jinx and Thresh are the strongest picks this patch." */
export function leadSentence(cards: readonly IndexCard[]): string | null {
  const seen = new Set<number>();
  const leaders: string[] = [];
  for (const card of sortCards(
    cards.filter((candidate) => candidate.main),
    "strongest",
  )) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    leaders.push(card.name);
    if (leaders.length === 2) break;
  }
  const [first, second] = leaders;
  if (first === undefined) return null;
  return second === undefined
    ? `${first} is the strongest pick this patch.`
    : `${first} and ${second} are the strongest picks this patch.`;
}
