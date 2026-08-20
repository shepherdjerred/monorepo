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
  stake: number;
};

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
}): string {
  const lines = [bucksPrematchLine({ prediction: input.prediction })];
  const humanPositions = input.positions.slice(0, MAX_VISIBLE_POSITIONS);
  const blueTotal = input.positions
    .filter((position) => position.teamId === 100)
    .reduce((total, position) => total + position.stake, 0);
  const redTotal = input.positions
    .filter((position) => position.teamId === 200)
    .reduce((total, position) => total + position.stake, 0);
  const heading = input.poolState === "open" ? "Live bets" : "Final bets";

  lines.push("");
  if (input.positions.length === 0) {
    lines.push(`🎲 **${heading}** — No bets yet.`);
    return lines.join("\n");
  }

  lines.push(
    `🎲 **${heading}** — Blue **${blueTotal.toString()} BB** · Red **${redTotal.toString()} BB**`,
  );
  for (const teamId of [100, 200] satisfies readonly RiotTeamId[]) {
    const teamPositions = humanPositions.filter(
      (position) => position.teamId === teamId,
    );
    if (teamPositions.length === 0) {
      continue;
    }
    lines.push(`**${teamName(teamId)}**`);
    for (const position of teamPositions) {
      lines.push(
        `• <@${position.discordId}> — **${position.stake.toString()} BB**`,
      );
    }
  }

  if (input.positions.length > MAX_VISIBLE_POSITIONS) {
    lines.push(
      `…and ${(input.positions.length - MAX_VISIBLE_POSITIONS).toString()} more position(s).`,
    );
  }
  return lines.join("\n");
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
