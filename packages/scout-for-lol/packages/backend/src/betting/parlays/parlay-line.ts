import { formatInteger } from "@scout-for-lol/data";
import type {
  BucksParlayMarketState,
  BucksParlaySide,
  BucksParlayVoidReason,
} from "@scout-for-lol/data";
import {
  renderParlay,
  type GeneratedParlay,
  type ParlaySubject,
} from "#src/betting/parlays/parlay-criteria.ts";
import { formatDecimalOdds } from "#src/betting/parlays/parlay-odds.ts";
import { splitMessageIntoChunks } from "#src/discord/utils/message.ts";

/**
 * The parlay market message.
 *
 * Recomputed from the stored definition rather than snapshotted the way the
 * outcome market snapshots `prematchContentBase`: everything this renders —
 * legs, subjects, odds, close time — is already persisted, so there is no
 * out-of-band content to preserve and no legacy market that cannot be
 * refreshed.
 */

const MAX_VISIBLE_POSITIONS = 15;

export type ParlayPosition = {
  discordId: string;
  side: BucksParlaySide;
  stake: number;
  grossPayout: number;
};

function probabilityPercent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

/** Human-readable void reasons; the raw enum must never reach a player. */
function voidReasonText(reason: BucksParlayVoidReason | undefined): string {
  switch (reason) {
    case "remake":
      return "remake";
    case "expired":
      return "the game never resolved";
    case "unsupported_mode":
      return "unsupported game mode";
    case "missing_data":
      return "missing match data";
    case "unknown_evaluator":
      return "a settlement rule changed";
    case "invalid_definition":
      return "an invalid parlay definition";
    case "storage_overflow":
      return "a result outside Bryan Bucks storage limits";
    case undefined:
      return "an unresolved market";
  }
}

function headerLines(input: {
  criteria: GeneratedParlay;
  subjects: readonly ParlaySubject[];
}): string[] {
  return [
    "🎲 **Bryan Bucks Parlay** — every leg must hit for YES",
    ...renderParlay(input.criteria, input.subjects).map(
      (leg, index) => `${formatInteger(index + 1)}. ${leg}`,
    ),
  ];
}

function statusLine(input: {
  criteria: GeneratedParlay;
  closesAt: Date;
  marketState: BucksParlayMarketState;
  voidReason: BucksParlayVoidReason | undefined;
}): string {
  const yes = input.criteria.yesProbabilityBps;
  const no = 10_000 - yes;
  const odds = `**YES** ${probabilityPercent(yes)} (${formatDecimalOdds(yes)}×) · **NO** ${probabilityPercent(no)} (${formatDecimalOdds(no)}×)`;
  switch (input.marketState) {
    case "publishing":
    case "open":
      return `${odds} · closes <t:${Math.floor(input.closesAt.getTime() / 1000).toString()}:R> · live in-play market`;
    case "closed":
      return `${odds} · closed — result after the game.`;
    case "settled":
      return `${odds} · settled — see the result below.`;
    case "voided":
      return `↩️ Voided (${voidReasonText(input.voidReason)}) — every stake and house reserve was returned.`;
  }
}

function positionLines(positions: readonly ParlayPosition[]): string[] {
  const lines: string[] = [];
  for (const side of ["YES", "NO"] satisfies readonly BucksParlaySide[]) {
    const held = positions.filter((position) => position.side === side);
    if (held.length === 0) {
      continue;
    }
    const names = held
      .map(
        (position) =>
          `<@${position.discordId}> ${formatInteger(position.stake)}`,
      )
      .join(" · ");
    lines.push(`**${side}** ${names}`);
  }
  return lines;
}

/**
 * Render the market message for its current state.
 *
 * Bounded the same way the outcome digest is: trim visible positions until the
 * whole message fits a single Discord chunk, preserving the invariant that a
 * parlay message is always exactly one message.
 */
export function buildParlayContent(input: {
  criteria: GeneratedParlay;
  subjects: readonly ParlaySubject[];
  closesAt: Date;
  marketState: BucksParlayMarketState;
  positions: readonly ParlayPosition[];
  voidReason?: BucksParlayVoidReason | undefined;
}): string {
  const header = headerLines(input);
  const status = statusLine({
    criteria: input.criteria,
    closesAt: input.closesAt,
    marketState: input.marketState,
    voidReason: input.voidReason,
  });

  let visibleCount = Math.min(input.positions.length, MAX_VISIBLE_POSITIONS);
  while (visibleCount >= 0) {
    const shown = input.positions.slice(0, visibleCount);
    const hidden = input.positions.length - visibleCount;
    const lines = [
      ...header,
      "",
      status,
      ...positionLines(shown),
      ...(hidden > 0 ? [`…and ${formatInteger(hidden)} more.`] : []),
    ];
    const chunks = splitMessageIntoChunks(lines.join("\n"));
    const message = chunks[0];
    if (message !== undefined && chunks.length === 1) {
      return message;
    }
    visibleCount -= 1;
  }
  throw new Error(
    "Bryan Bucks parlay publication exceeds Discord's message limit.",
  );
}
