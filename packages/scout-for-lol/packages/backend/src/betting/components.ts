import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
} from "discord.js";
import type { BucksPoolParticipant, RiotTeamId } from "@scout-for-lol/data";
import { BLUE_TEAM_ID, BUTTON_STAKES } from "#src/betting/constants.ts";
import { formatBucksCustomId } from "#src/betting/custom-id.ts";
import { formatInteger } from "#src/betting/display-format.ts";
import {
  BETTING_TEAM_IDS,
  hasTrackedPlayersOnBothTeams,
  outcomeLabel,
  subjectWinsForTeam,
  type OutcomeFraming,
} from "#src/betting/team.ts";

/**
 * The betting buttons attached to a prematch message.
 *
 * One row for the game's two possible outcomes. Each team gets the two fixed
 * stake denominations and the fifth component cancels the bettor's position.
 * Anything else goes through `/bb bet`.
 */

export type BettableSubject = {
  /** Index into the pool's frozen roster — what the custom ID carries. */
  index: number;
  /** Used only to translate a direct team choice into the v1 WIN/LOSE ID. */
  teamId: RiotTeamId;
  /** Tracked players on both teams, so this game's copy stays Blue/Red. */
  mixedTeams: boolean;
};

/** How this game's two outcomes should be named. */
export function subjectFraming(subject: BettableSubject): OutcomeFraming {
  return { anchorTeamId: subject.teamId, mixedTeams: subject.mixedTeams };
}

/**
 * The first tracked player in roster order, used as this game's button anchor.
 *
 * The custom ID remains player-relative for compatibility, but the visible
 * controls are team-relative. A privacy-scrubbed participant carries no PUUID
 * and cannot anchor a bet.
 */
export function bettingAnchor(
  roster: readonly BucksPoolParticipant[],
): BettableSubject | undefined {
  const mixedTeams = hasTrackedPlayersOnBothTeams(roster);
  for (const [index, participant] of roster.entries()) {
    if (participant.trackedAlias === undefined || participant.puuid === null) {
      continue;
    }
    return { index, teamId: participant.teamId, mixedTeams };
  }
  return undefined;
}

/**
 * Green for the tracked player winning, red for losing; the mixed lobby keeps
 * the literal Blue/Red colours because neither side is "ours".
 */
function buttonStyleFor(
  teamId: RiotTeamId,
  anchor: BettableSubject,
): ButtonStyle.Primary | ButtonStyle.Success | ButtonStyle.Danger {
  if (anchor.mixedTeams) {
    return teamId === BLUE_TEAM_ID ? ButtonStyle.Primary : ButtonStyle.Danger;
  }
  return teamId === anchor.teamId ? ButtonStyle.Success : ButtonStyle.Danger;
}

function buildRow(input: {
  matchId: string;
  anchor: BettableSubject;
  /** Rendered greyed out once the window has closed. */
  disabled: boolean;
}): ActionRowBuilder<ButtonBuilder> {
  const buttons: ButtonBuilder[] = [];

  for (const teamId of BETTING_TEAM_IDS) {
    for (const stake of BUTTON_STAKES) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(
            formatBucksCustomId({
              action: "b",
              matchId: input.matchId,
              subjectIndex: input.anchor.index,
              side: subjectWinsForTeam(input.anchor.teamId, teamId) ? "W" : "L",
              amount: stake,
            }),
          )
          .setLabel(
            `${outcomeLabel(teamId, subjectFraming(input.anchor))} · ${formatInteger(stake)} BB`,
          )
          .setStyle(buttonStyleFor(teamId, input.anchor))
          .setDisabled(input.disabled),
      );
    }
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(
        formatBucksCustomId({
          action: "x",
          matchId: input.matchId,
          subjectIndex: input.anchor.index,
          side: "W",
          amount: 0,
        }),
      )
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(input.disabled),
  );

  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}

/**
 * Build the betting rows for a prematch message.
 *
 * Returns an empty array when there is nobody to bet on, so a caller can spread
 * it into a message payload unconditionally.
 */
export function buildBettingRows(input: {
  matchId: string;
  roster: readonly BucksPoolParticipant[];
  disabled?: boolean;
}): ActionRowBuilder<ButtonBuilder>[] {
  const anchor = bettingAnchor(input.roster);
  if (anchor === undefined) {
    return [];
  }
  return [
    buildRow({
      matchId: input.matchId,
      anchor,
      disabled: input.disabled ?? false,
    }),
  ];
}

/**
 * The same rows, greyed out.
 *
 * Used when a window closes. Purely cosmetic — a click on a live-looking button
 * is still refused by `placeBet`, which re-checks `closesAt` inside its
 * transaction.
 */
export function disableRows(
  rows: readonly APIActionRowComponent<APIComponentInMessageActionRow>[],
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  return rows.map((row) => ({
    ...row,
    components: row.components.map((component) =>
      "custom_id" in component
        ? { ...component, disabled: true }
        : { ...component },
    ),
  }));
}
