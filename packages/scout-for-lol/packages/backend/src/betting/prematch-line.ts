import type {
  BucksPoolState,
  BucksPrediction,
  RiotTeamId,
} from "@scout-for-lol/data";
import { HOUSE_CUT_TERMS } from "#src/betting/house-cut.ts";
import { shouldDisplayPrediction } from "#src/betting/prediction.ts";
import { teamName } from "#src/betting/team.ts";

/**
 * The Bryan Bucks lines appended to a prematch message.
 *
 * Kept separate from the notification module so the text can be unit-tested
 * without a Discord client, and so the length rule below lives next to the
 * strings it governs.
 */

/** Discord's hard limit on message content. */
const MAX_CONTENT_LENGTH = 2000;
const MAX_VISIBLE_POSITIONS = 15;

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

function positionLines(
  positions: readonly BucksPrematchPosition[],
  isOpen: boolean,
): string[] {
  const lines: string[] = [];
  for (const teamId of [100, 200] satisfies readonly RiotTeamId[]) {
    const teamPositions = positions.filter(
      (position) => position.teamId === teamId,
    );
    if (teamPositions.length === 0) {
      continue;
    }
    lines.push(`**${teamName(teamId)}**`);
    for (const position of teamPositions) {
      if (isOpen) {
        lines.push(
          `• <@${position.discordId}> — offered **${position.offeredStake.toString()} BB**`,
        );
      } else {
        const allocation = finalAllocation(position);
        lines.push(
          `• <@${position.discordId}> — offered **${position.offeredStake.toString()} BB** · matched **${allocation.matchedStake.toString()} BB** · refunded **${allocation.unmatchedStake.toString()} BB**`,
        );
      }
    }
  }
  return lines;
}

function boundedPositionDigest(input: {
  lines: readonly string[];
  positions: readonly BucksPrematchPosition[];
  isOpen: boolean;
}): string {
  let visibleCount = Math.min(input.positions.length, MAX_VISIBLE_POSITIONS);
  while (visibleCount >= 0) {
    const candidateLines = [
      ...input.lines,
      ...positionLines(input.positions.slice(0, visibleCount), input.isOpen),
    ];
    const hiddenCount = input.positions.length - visibleCount;
    if (hiddenCount > 0) {
      candidateLines.push(`…and ${hiddenCount.toString()} more position(s).`);
    }
    const candidate = candidateLines.join("\n");
    if (candidate.length <= MAX_CONTENT_LENGTH) {
      return candidate;
    }
    visibleCount -= 1;
  }
  throw new Error("Bryan Bucks prematch footer exceeds Discord's limit");
}

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
 * Build the optional betting line.
 *
 * A prediction close to even odds is deliberately omitted: the buttons are
 * useful, but a nearly arbitrary call is not useful to read.
 */
export function bucksPrematchLine(input: {
  prediction: BucksPrediction | undefined;
}): string {
  const prediction =
    input.prediction !== undefined &&
    shouldDisplayPrediction(input.prediction.winProbability)
      ? `${input.prediction.sentence}\n`
      : "";
  return `${prediction}${HOUSE_CUT_TERMS}`;
}

/**
 * Build the complete live betting portion of the prematch message.
 *
 * Positions are already sorted by the database query that reads them. Keeping
 * that order here means repeated refreshes do not make rows jump around.
 */
export function bucksPrematchSummary(input: {
  prediction: BucksPrediction | undefined;
  poolState: BucksPoolState;
  positions: readonly BucksPrematchPosition[];
  houseMatches?: readonly BucksPrematchHouseMatch[];
}): string {
  const lines = [bucksPrematchLine({ prediction: input.prediction })];
  const houseMatches = input.houseMatches ?? [];
  const isOpen = input.poolState === "open";

  if (isOpen && houseMatches.length > 0) {
    throw new Error("An open Bryan Bucks pool cannot contain a house match");
  }

  lines.push("");
  if (input.positions.length === 0) {
    lines.push(
      isOpen
        ? "🎲 **Live offers** — No offers yet."
        : "🎲 **Final matched stakes** — No active offers at close.",
    );
    return lines.join("\n");
  }

  if (isOpen) {
    const blueOffered = input.positions
      .filter((position) => position.teamId === 100)
      .reduce((total, position) => total + position.offeredStake, 0);
    const redOffered = input.positions
      .filter((position) => position.teamId === 200)
      .reduce((total, position) => total + position.offeredStake, 0);
    lines.push(
      `🎲 **Live offers** — Blue **${blueOffered.toString()} BB offered** · Red **${redOffered.toString()} BB offered**`,
    );
  } else {
    const matchedForTeam = (teamId: RiotTeamId): number =>
      input.positions
        .filter((position) => position.teamId === teamId)
        .reduce(
          (total, position) => total + finalAllocation(position).matchedStake,
          0,
        ) +
      houseMatches
        .filter((position) => position.teamId === teamId)
        .reduce((total, position) => total + position.matchedStake, 0);
    const blueMatched = matchedForTeam(100);
    const redMatched = matchedForTeam(200);
    lines.push(
      `🎲 **Final matched stakes** — Blue **${blueMatched.toString()} BB** · Red **${redMatched.toString()} BB**`,
    );
    for (const houseMatch of houseMatches) {
      lines.push(
        `🏦 House matched **${houseMatch.matchedStake.toString()} BB** on **${teamName(houseMatch.teamId)}**.`,
      );
    }
  }

  return boundedPositionDigest({
    lines,
    positions: input.positions,
    isOpen,
  });
}

/**
 * Append the betting footer to a message, truncating the base if needed so an
 * open market never loses its house-cut disclosure.
 *
 * The footer is internal, bounded copy. If it alone cannot fit, that is a
 * broken caller contract and must fail loudly rather than sending partial
 * terms.
 */
export function appendBucksLine(base: string, footer: string): string {
  if (footer.length === 0) {
    return base;
  }
  if (base.length === 0) {
    if (footer.length > MAX_CONTENT_LENGTH) {
      throw new Error("Bryan Bucks prematch footer exceeds Discord's limit");
    }
    return footer;
  }
  const combined = `${base}\n\n${footer}`;
  if (combined.length <= MAX_CONTENT_LENGTH) {
    return combined;
  }
  const baseLength = MAX_CONTENT_LENGTH - footer.length - 2;
  if (baseLength < 0) {
    throw new Error("Bryan Bucks prematch footer exceeds Discord's limit");
  }
  return `${base.slice(0, baseLength)}\n\n${footer}`;
}
