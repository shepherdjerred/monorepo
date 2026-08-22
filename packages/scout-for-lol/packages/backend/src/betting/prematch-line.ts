import type {
  BucksPoolState,
  BucksPrediction,
  RiotTeamId,
} from "@scout-for-lol/data";
import { BETTING_TEAM_IDS, outcomeLabel } from "#src/betting/team.ts";
import type { OutcomeFraming } from "#src/betting/team.ts";

/**
 * The Bryan Bucks lines appended to a prematch message.
 *
 * Kept separate from the notification module so the text can be unit-tested
 * without a Discord client, and so the length rule below lives next to the
 * strings it governs.
 *
 * These lines state numbers, never rules. Every rule lives in `/bb rules`; a
 * market that re-explained the fee schedule on every game was 17% of all the
 * Bryan Bucks text a player ever saw.
 */

/** Discord's hard limit on message content. */
const MAX_CONTENT_LENGTH = 2000;
const MAX_VISIBLE_POSITIONS = 15;

/** Where the rules actually live, so no other surface has to restate them. */
export const BUCKS_RULES_HINT = "`/bb rules`";

export type BucksPrematchPosition = {
  discordId: string;
  teamId: RiotTeamId;
  offeredStake: number;
  matchedStake: number | null;
  unmatchedStake: number | null;
};

export type BucksPrematchHouseMatch = {
  teamId: RiotTeamId;
  matchedStake: number;
};

function finalAllocation(position: BucksPrematchPosition): {
  matchedStake: number;
  unmatchedStake: number;
} {
  if (
    position.matchedStake === null ||
    position.unmatchedStake === null ||
    position.offeredStake !== position.matchedStake + position.unmatchedStake
  ) {
    throw new Error(
      `Bryan Bucks position for ${position.discordId} has no valid final allocation`,
    );
  }
  return {
    matchedStake: position.matchedStake,
    unmatchedStake: position.unmatchedStake,
  };
}

/**
 * While the market is open, names are grouped one line per side.
 *
 * One line per bettor was the single largest contributor to the old footer's
 * length, and the offered amount is the only number that matters before close.
 */
function openPositionLines(
  positions: readonly BucksPrematchPosition[],
  framing: OutcomeFraming | undefined,
): string[] {
  const lines: string[] = [];
  for (const teamId of BETTING_TEAM_IDS) {
    const side = positions.filter((position) => position.teamId === teamId);
    if (side.length === 0) {
      continue;
    }
    const names = side
      .map(
        (position) =>
          `<@${position.discordId}> ${position.offeredStake.toString()}`,
      )
      .join(" · ");
    lines.push(`**${outcomeLabel(teamId, framing)}** ${names}`);
  }
  return lines;
}

/**
 * At close the message becomes the receipt, so each bettor gets their own row
 * with the offered/matched/refunded arithmetic preserved in full.
 */
function closedPositionLines(
  positions: readonly BucksPrematchPosition[],
  framing: OutcomeFraming | undefined,
): string[] {
  return positions.map((position) => {
    const allocation = finalAllocation(position);
    const refunded =
      allocation.unmatchedStake > 0
        ? `, refunded **${allocation.unmatchedStake.toString()}**`
        : "";
    return `• <@${position.discordId}> ${outcomeLabel(position.teamId, framing)} ${position.offeredStake.toString()} → matched **${allocation.matchedStake.toString()}**${refunded}`;
  });
}

function positionLines(
  positions: readonly BucksPrematchPosition[],
  isOpen: boolean,
  framing: OutcomeFraming | undefined,
): string[] {
  return isOpen
    ? openPositionLines(positions, framing)
    : closedPositionLines(positions, framing);
}

function boundedPositionDigest(input: {
  lines: readonly string[];
  positions: readonly BucksPrematchPosition[];
  isOpen: boolean;
  framing: OutcomeFraming | undefined;
  maxLength: number;
}): string {
  let visibleCount = Math.min(input.positions.length, MAX_VISIBLE_POSITIONS);
  while (visibleCount >= 0) {
    const candidateLines = [
      ...input.lines,
      ...positionLines(
        input.positions.slice(0, visibleCount),
        input.isOpen,
        input.framing,
      ),
    ];
    const hiddenCount = input.positions.length - visibleCount;
    if (hiddenCount > 0) {
      candidateLines.push(`…and ${hiddenCount.toString()} more.`);
    }
    const candidate = candidateLines.join("\n");
    if (candidate.length <= input.maxLength) {
      return candidate;
    }
    visibleCount -= 1;
  }
  throw new Error("Bryan Bucks prematch digest exceeds its length budget");
}

function totalsFor(input: {
  positions: readonly BucksPrematchPosition[];
  houseMatches: readonly BucksPrematchHouseMatch[];
  teamId: RiotTeamId;
  isOpen: boolean;
}): number {
  const own = input.positions
    .filter((position) => position.teamId === input.teamId)
    .reduce(
      (total, position) =>
        total +
        (input.isOpen
          ? position.offeredStake
          : finalAllocation(position).matchedStake),
      0,
    );
  const house = input.houseMatches
    .filter((match) => match.teamId === input.teamId)
    .reduce((total, match) => total + match.matchedStake, 0);
  return own + house;
}

/** `closes <t:…:R>`, omitted when the caller has no authoritative close time. */
function closesClause(closesAt: Date | undefined): string {
  if (closesAt === undefined) {
    return "";
  }
  return ` · closes <t:${Math.floor(closesAt.getTime() / 1000).toString()}:R>`;
}

/**
 * Build the complete live betting portion of the prematch message.
 *
 * Positions are already sorted by the database query that reads them. Keeping
 * that order here means repeated refreshes do not make rows jump around.
 *
 * `prediction` is accepted and deliberately unused: pregame estimates are never
 * public, and keeping the parameter documents that this is a decision rather
 * than an omission.
 */
export function bucksPrematchSummary(input: {
  prediction: BucksPrediction | undefined;
  poolState: BucksPoolState;
  positions: readonly BucksPrematchPosition[];
  houseMatches?: readonly BucksPrematchHouseMatch[] | undefined;
  framing?: OutcomeFraming | undefined;
  closesAt?: Date | undefined;
  /** Characters available after the non-betting content. */
  maxLength?: number | undefined;
}): string {
  const houseMatches = input.houseMatches ?? [];
  const isOpen = input.poolState === "open";
  const maxLength = input.maxLength ?? MAX_CONTENT_LENGTH;

  if (isOpen && houseMatches.length > 0) {
    throw new Error("An open Bryan Bucks pool cannot contain a house match");
  }

  if (input.positions.length === 0) {
    return isOpen
      ? `🎲 **Bets open**${closesClause(input.closesAt)} — no offers yet · ${BUCKS_RULES_HINT}`
      : "🎲 **Bets closed** — no offers matched.";
  }

  const [first, second] = BETTING_TEAM_IDS;
  if (first === undefined || second === undefined) {
    throw new Error("Bryan Bucks has no betting sides configured");
  }
  const totals = [first, second].map((teamId) => ({
    teamId,
    label: outcomeLabel(teamId, input.framing),
    total: totalsFor({
      positions: input.positions,
      houseMatches,
      teamId,
      isOpen,
    }),
  }));
  const totalsText = totals
    .map((side) => `${side.label} **${side.total.toString()} BB**`)
    .join(" · ");

  const header = isOpen
    ? `🎲 **Bets open**${closesClause(input.closesAt)} — ${totalsText}`
    : `🎲 **Bets closed** — ${totalsText}${houseClause(houseMatches, input.framing)}`;

  return boundedPositionDigest({
    lines: [header],
    positions: input.positions,
    isOpen,
    framing: input.framing,
    maxLength,
  });
}

/** `(house **5** on LOSE)` — the aggregate fill, without naming the account. */
function houseClause(
  houseMatches: readonly BucksPrematchHouseMatch[],
  framing: OutcomeFraming | undefined,
): string {
  if (houseMatches.length === 0) {
    return "";
  }
  const parts = houseMatches.map(
    (match) =>
      `house **${match.matchedStake.toString()}** on ${outcomeLabel(match.teamId, framing)}`,
  );
  return ` (${parts.join(", ")})`;
}

/** Characters a digest may use once the non-betting content is accounted for. */
export function digestBudgetFor(base: string): number {
  if (base.length === 0) {
    return MAX_CONTENT_LENGTH;
  }
  return MAX_CONTENT_LENGTH - base.length - 2;
}

/**
 * Join the non-betting content and the betting digest.
 *
 * The digest is bounded by `digestBudgetFor` before it reaches here, so the
 * base is never truncated. That inverts the previous contract, which sacrificed
 * the player names to protect a house-cut disclosure that no longer exists — a
 * digest that cannot fit is now a broken caller, not a reason to eat the report.
 */
export function withBucksDigest(base: string, digest: string): string {
  if (digest.length === 0) {
    return base;
  }
  if (base.length === 0) {
    if (digest.length > MAX_CONTENT_LENGTH) {
      throw new Error("Bryan Bucks prematch digest exceeds Discord's limit");
    }
    return digest;
  }
  const combined = `${base}\n\n${digest}`;
  if (combined.length > MAX_CONTENT_LENGTH) {
    throw new Error("Bryan Bucks prematch content exceeds Discord's limit");
  }
  return combined;
}
