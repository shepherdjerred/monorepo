import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type MessageCreateOptions,
} from "discord.js";
import type { LeaguePuuid, MatchId } from "@scout-for-lol/data";
import type { MatchMvpCategory } from "#src/mvp-votes/custom-id.ts";
import {
  formatVoteButtonCustomId,
  formatVoteModalCustomId,
  formatVoteSelectCustomId,
} from "#src/mvp-votes/custom-id.ts";
import {
  MVP_JUSTIFICATION_FIELD_ID,
  MVP_JUSTIFICATION_MAX_LENGTH,
  MVP_VOTE_SELECT_PLACEHOLDER,
  voteButtonLabel,
  voteModalTitle,
} from "#src/mvp-votes/copy.ts";
import { teamLabel, type MatchMvpRoster } from "#src/mvp-votes/roster.ts";
import { displayNameFor, emptyMvpTallyEmbed } from "#src/mvp-votes/tally.ts";

const SELECT_LABEL_MAX = 100;

function truncateLabel(label: string): string {
  return label.length <= SELECT_LABEL_MAX
    ? label
    : `${label.slice(0, SELECT_LABEL_MAX - 1)}…`;
}

export function mvpVoteButtonRow(
  matchId: MatchId,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(formatVoteButtonCustomId({ category: "ally", matchId }))
      .setStyle(ButtonStyle.Primary)
      .setLabel(voteButtonLabel("ally")),
    new ButtonBuilder()
      .setCustomId(formatVoteButtonCustomId({ category: "enemy", matchId }))
      .setStyle(ButtonStyle.Secondary)
      .setLabel(voteButtonLabel("enemy")),
  );
}

export function withMvpVoteFurniture(
  message: MessageCreateOptions,
  matchId: MatchId,
): MessageCreateOptions {
  const components = [...(message.components ?? []), mvpVoteButtonRow(matchId)];
  const embeds = [...(message.embeds ?? []), emptyMvpTallyEmbed()];
  return { ...message, components, embeds };
}

export function mvpVoteSelectRow(input: {
  matchId: MatchId;
  category: MatchMvpCategory;
  roster: MatchMvpRoster;
  aliases: ReadonlyMap<LeaguePuuid, string>;
}): ActionRowBuilder<StringSelectMenuBuilder> {
  // Both ballots list all ten participants. Ally/enemy are independent
  // nominations, not team filters.
  const options = input.roster.participants.map((participant, index) => {
    const name = displayNameFor(participant.puuid, input.roster, input.aliases);
    return new StringSelectMenuOptionBuilder()
      .setLabel(
        truncateLabel(
          `${teamLabel(participant.teamId)} · ${participant.championName} · ${name}`,
        ),
      )
      .setValue(String(index));
  });
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(
        formatVoteSelectCustomId({
          category: input.category,
          matchId: input.matchId,
        }),
      )
      .setPlaceholder(MVP_VOTE_SELECT_PLACEHOLDER)
      .addOptions(options),
  );
}

export function mvpVoteModal(input: {
  matchId: MatchId;
  category: MatchMvpCategory;
  nomineeIndex: number;
}): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(
      formatVoteModalCustomId({
        category: input.category,
        matchId: input.matchId,
        nomineeIndex: input.nomineeIndex,
      }),
    )
    .setTitle(voteModalTitle(input.category))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Reason (optional)")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(MVP_JUSTIFICATION_FIELD_ID)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(MVP_JUSTIFICATION_MAX_LENGTH)
            .setPlaceholder("optional"),
        ),
    );
}
