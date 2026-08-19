import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { BUTTON_STAKES } from "#src/betting/constants.ts";
import { formatParlayCustomId } from "#src/betting/parlay-custom-id.ts";

export function buildParlayButtons(input: {
  matchId: string;
  disabled?: boolean;
}): ActionRowBuilder<ButtonBuilder> {
  const disabled = input.disabled ?? false;
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (const side of ["YES", "NO"] as const) {
    for (const stake of BUTTON_STAKES) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(
            formatParlayCustomId({
              action: "b",
              matchId: input.matchId,
              side,
              amount: stake,
            }),
          )
          .setLabel(`${side} ${stake.toString()}`)
          .setStyle(side === "YES" ? ButtonStyle.Success : ButtonStyle.Danger)
          .setDisabled(disabled),
      );
    }
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(
        formatParlayCustomId({
          action: "x",
          matchId: input.matchId,
          side: "YES",
          amount: 0,
        }),
      )
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
  return row;
}
