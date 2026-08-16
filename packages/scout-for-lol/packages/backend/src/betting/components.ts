import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
} from "discord.js";
import type { BucksPoolParticipant } from "@scout-for-lol/data";
import { BUTTON_STAKES } from "#src/betting/constants.ts";
import { formatBucksCustomId } from "#src/betting/custom-id.ts";

/**
 * The betting buttons attached to a prematch message.
 *
 * One row per tracked player, each holding exactly five components — Discord's
 * per-row cap — which is what fixes the stake denominations at two values plus
 * a cancel. Anything else goes through `/bb bet`.
 */

/** Discord's cap on action rows in a message. */
const MAX_ROWS = 5;

/** Discord's cap on a button label. Aliases are truncated well inside it so a
 * long name cannot break the send. */
const MAX_ALIAS_LENGTH = 12;

function truncateAlias(alias: string): string {
  if (alias.length <= MAX_ALIAS_LENGTH) {
    return alias;
  }
  return `${alias.slice(0, MAX_ALIAS_LENGTH - 1)}…`;
}

export type BettableSubject = {
  /** Index into the pool's frozen roster — what the custom ID carries. */
  index: number;
  alias: string;
};

/**
 * The tracked players in a roster that can be bet on, in roster order.
 *
 * A privacy-scrubbed participant carries no PUUID and so can never be a bet's
 * subject; it is skipped rather than rendered as an unusable button.
 */
export function bettableSubjects(
  roster: readonly BucksPoolParticipant[],
): BettableSubject[] {
  const subjects: BettableSubject[] = [];
  for (const [index, participant] of roster.entries()) {
    if (participant.trackedAlias === undefined || participant.puuid === null) {
      continue;
    }
    subjects.push({ index, alias: participant.trackedAlias });
  }
  return subjects;
}

function buildRow(input: {
  matchId: string;
  subject: BettableSubject;
  /** Rendered greyed out once the window has closed. */
  disabled: boolean;
  /** Only the first row names the player, since the rest are self-evident. */
  showAlias: boolean;
}): ActionRowBuilder<ButtonBuilder> {
  const alias = truncateAlias(input.subject.alias);
  const buttons: ButtonBuilder[] = [];

  for (const [position, stake] of BUTTON_STAKES.entries()) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(
          formatBucksCustomId({
            action: "b",
            matchId: input.matchId,
            subjectIndex: input.subject.index,
            side: "W",
            amount: stake,
          }),
        )
        .setLabel(
          position === 0 && input.showAlias
            ? `${alias} WIN ${stake.toString()}`
            : `WIN ${stake.toString()}`,
        )
        .setStyle(ButtonStyle.Success)
        .setDisabled(input.disabled),
    );
  }

  for (const stake of BUTTON_STAKES) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(
          formatBucksCustomId({
            action: "b",
            matchId: input.matchId,
            subjectIndex: input.subject.index,
            side: "L",
            amount: stake,
          }),
        )
        .setLabel(`LOSE ${stake.toString()}`)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(input.disabled),
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(
        formatBucksCustomId({
          action: "x",
          matchId: input.matchId,
          subjectIndex: input.subject.index,
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
  const subjects = bettableSubjects(input.roster).slice(0, MAX_ROWS);
  return subjects.map((subject, position) =>
    buildRow({
      matchId: input.matchId,
      subject,
      disabled: input.disabled ?? false,
      showAlias: position === 0 || subjects.length > 1,
    }),
  );
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

/** How many players the message can offer buttons for, so callers can tell the
 * reader when some were left out. */
export const MAX_BETTING_ROWS = MAX_ROWS;
